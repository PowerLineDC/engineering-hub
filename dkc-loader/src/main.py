from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "config.json"
STATE_PATH = ROOT / "output" / "state.json"
PRODUCTS_PATH = ROOT / "output" / "products.jsonl"
ERRORS_PATH = ROOT / "output" / "errors.jsonl"
INCOMPLETE_PATH = ROOT / "output" / "incomplete.jsonl"


@dataclass
class Config:
    start_urls: list[str]
    allowed_hosts: set[str]
    request_delay_seconds: float
    max_concurrency: int
    timeout_seconds: float
    max_retries: int
    user_agent: str
    respect_robots_txt: bool
    max_pages: int
    follow_external_links: bool
    save_images: bool
    dry_run: bool


def load_config() -> Config:
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return Config(
        start_urls=data["start_urls"],
        allowed_hosts=set(data["allowed_hosts"]),
        request_delay_seconds=data["request_delay_seconds"],
        max_concurrency=data["max_concurrency"],
        timeout_seconds=data["timeout_seconds"],
        max_retries=data["max_retries"],
        user_agent=data["user_agent"],
        respect_robots_txt=data["respect_robots_txt"],
        max_pages=data["max_pages"],
        follow_external_links=data["follow_external_links"],
        save_images=data["save_images"],
        dry_run=data["dry_run"],
    )


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {"visited": [], "product_urls": [], "errors": 0, "pages": 0}


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def append_jsonl(path: Path, item: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")


class RateLimiter:
    def __init__(self, delay: float):
        self.delay = delay
        self.lock = asyncio.Lock()
        self.last_request = 0.0

    async def wait(self) -> None:
        async with self.lock:
            now = time.monotonic()
            wait_for = self.delay - (now - self.last_request)
            if wait_for > 0:
                await asyncio.sleep(wait_for)
            self.last_request = time.monotonic()


class RobotsPolicy:
    def __init__(self, client: httpx.AsyncClient, user_agent: str):
        self.client = client
        self.user_agent = user_agent
        self.parsers: dict[str, RobotFileParser | None] = {}

    async def allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self.parsers:
            robots_url = f"{origin}/robots.txt"
            try:
                response = await self.client.get(robots_url)
                if response.status_code >= 400:
                    self.parsers[origin] = None
                else:
                    rp = RobotFileParser()
                    rp.set_url(robots_url)
                    rp.parse(response.text.splitlines())
                    self.parsers[origin] = rp
            except httpx.HTTPError:
                self.parsers[origin] = None
                return False
        rp = self.parsers[origin]
        return False if rp is None else rp.can_fetch(self.user_agent, url)


class DKCParser:
    """Conservative parser limited to the configured catalog root."""

    def __init__(self, root_url: str):
        parsed = urlparse(root_url)
        self.root_prefix = parsed.path.rstrip("/") + "/"
        self.root_url = root_url.rstrip("/") + "/"

    def in_scope(self, url: str) -> bool:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            return False
        if parsed.netloc not in {"www.dkc.ru", "dkc.ru"}:
            return False
        path = parsed.path.rstrip("/") + "/"
        return path == self.root_prefix or path.startswith(self.root_prefix)

    @staticmethod
    def is_service_url(url: str) -> bool:
        path = urlparse(url).path.lower()
        return any(part in path for part in ("/compare.php", "/sale/", "/search/", "/search.php"))

    def is_product_url(self, url: str) -> bool:
        """Product pages are deeper than the catalog root, but categories are also allowed through discovery.
        Final product detection is additionally based on the page title/content, not URL depth alone.
        """
        return self.in_scope(url) and not self.is_service_url(url)

    def parse_links(self, html: str, page_url: str) -> tuple[set[str], set[str]]:
        soup = BeautifulSoup(html, "lxml")
        catalog_links: set[str] = set()
        candidate_links: set[str] = set()
        for a in soup.find_all("a", href=True):
            url = urljoin(page_url, a["href"]).split("#", 1)[0]
            if not self.in_scope(url) or self.is_service_url(url):
                continue
            candidate_links.add(url)
        # All in-scope links are candidates. The product/category distinction is made
        # from the actual page content during fetch, avoiding the previous URL-depth bug.
        catalog_links.update(candidate_links)
        return catalog_links, set()

    @staticmethod
    def normalize_text(text: str) -> str:
        return re.sub(r"\s+", " ", text).strip()

    @staticmethod
    def is_assembled_cqe_title(title: str | None) -> bool:
        if not title:
            return False
        normalized = DKCParser.normalize_text(title).lower()
        return normalized.startswith("напольный собранный корпус cqe n")

    @staticmethod
    def is_archived(soup: BeautifulSoup, title: str | None) -> bool:
        page_text = DKCParser.normalize_text(soup.get_text(" ", strip=True)).lower()
        archive_markers = (
            "архив",
            "архивный",
            "снято с производства",
            "не производится",
            "production discontinued",
            "discontinued",
        )
        return any(marker in page_text for marker in archive_markers)

    def parse_product(self, html: str, url: str) -> tuple[dict | None, list[dict]]:
        soup = BeautifulSoup(html, "lxml")
        title_tag = soup.find("h1")
        title = self.normalize_text(title_tag.get_text(" ", strip=True)) if title_tag else None

        if self.is_assembled_cqe_title(title):
            return None, []
        if self.is_archived(soup, title):
            return None, []

        # A real product page normally exposes a product title and a product code.
        # Category/navigation pages are not emitted as products.
        if not title:
            return None, []

        article = None
        for label in soup.find_all(string=lambda s: s and "Код" in s.strip()):
            parent_text = self.normalize_text(label.parent.get_text(" ", strip=True)) if label.parent else ""
            match = re.search(r"Код\s*[:№]?\s*([A-Za-zА-Яа-я0-9._-]+)", parent_text, re.IGNORECASE)
            if match:
                article = match.group(1)
                break

        # If there is no article/code, treat the page as a category/navigation page.
        if not article:
            return None, []

        product = {
            "source": "DKC",
            "source_url": url,
            "name": title,
            "article": article,
            "characteristics": {},
        }
        return product, []


async def fetch(client: httpx.AsyncClient, limiter: RateLimiter, robots: RobotsPolicy,
                url: str, cfg: Config) -> str:
    if cfg.respect_robots_txt and not await robots.allowed(url):
        raise PermissionError(f"robots.txt does not permit crawling: {url}")

    last_error = None
    for attempt in range(cfg.max_retries + 1):
        try:
            await limiter.wait()
            response = await client.get(url, follow_redirects=True)
            response.raise_for_status()
            return response.text
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            last_error = repr(exc)
            if attempt < cfg.max_retries:
                await asyncio.sleep(2 ** attempt)
    raise RuntimeError(last_error or "request failed")


async def crawl(cfg: Config) -> None:
    state = load_state()
    visited = set(state.get("visited", []))
    product_urls = set(state.get("product_urls", []))
    queue = list(cfg.start_urls)
    limiter = RateLimiter(cfg.request_delay_seconds)
    parser = DKCParser(cfg.start_urls[0])

    headers = {"User-Agent": cfg.user_agent, "Accept-Language": "ru,en;q=0.5"}
    timeout = httpx.Timeout(cfg.timeout_seconds)

    print("DKC Loader starting...", flush=True)
    print(f"Scope: {parser.root_url}", flush=True)
    print(f"Start URLs: {len(queue)} | dry_run: {cfg.dry_run}", flush=True)
    print(f"Request delay: {cfg.request_delay_seconds}s | robots.txt: {cfg.respect_robots_txt}", flush=True)

    async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
        robots = RobotsPolicy(client, cfg.user_agent)
        while queue and len(visited) < cfg.max_pages:
            url = queue.pop(0)
            if url in visited or not parser.in_scope(url) or parser.is_service_url(url):
                continue
            print(f"[DISCOVERY] {url}", flush=True)
            try:
                html = await fetch(client, limiter, robots, url, cfg)
                visited.add(url)
                state["pages"] = len(visited)
                catalog_links, _ = parser.parse_links(html, url)

                # Determine whether this page itself is a real product page.
                product, _ = parser.parse_product(html, url)
                if product is not None:
                    product_urls.add(url)
                    print(f"  PRODUCT: {product['article']} | {product['name']}", flush=True)
                else:
                    print(f"  category/navigation page | links: {len(catalog_links)}", flush=True)

                for link in sorted(catalog_links):
                    if link not in visited and link not in queue:
                        queue.append(link)
            except Exception as exc:
                state["errors"] = state.get("errors", 0) + 1
                append_jsonl(ERRORS_PATH, {"url": url, "stage": "discovery", "error": repr(exc)})
                print(f"  ERROR: {exc!r}", flush=True)

            state["visited"] = sorted(visited)
            state["product_urls"] = sorted(product_urls)
            save_state(state)

        print(f"Discovery finished: {len(visited)} pages, {len(product_urls)} eligible product pages, {state.get('errors', 0)} errors", flush=True)

        for index, url in enumerate(sorted(product_urls), start=1):
            try:
                print(f"[PRODUCT {index}/{len(product_urls)}] {url}", flush=True)
                html = await fetch(client, limiter, robots, url, cfg)
                product, incomplete = parser.parse_product(html, url)
                for item in incomplete:
                    append_jsonl(INCOMPLETE_PATH, item)
                if product is not None and not cfg.dry_run:
                    append_jsonl(PRODUCTS_PATH, product)
            except Exception as exc:
                append_jsonl(ERRORS_PATH, {"url": url, "stage": "product", "error": repr(exc)})
                print(f"  ERROR: {exc!r}", flush=True)

    save_state(state)
    print("DKC Loader finished.", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="DKC catalog loader")
    parser.add_argument("--live", action="store_true", help="write extracted products to output/products.jsonl")
    parser.add_argument("--fresh", action="store_true", help="ignore previous crawl state and start from configured root")
    args = parser.parse_args()
    cfg = load_config()
    if args.live:
        cfg.dry_run = False
    if args.fresh and STATE_PATH.exists():
        STATE_PATH.unlink()
    asyncio.run(crawl(cfg))


if __name__ == "__main__":
    main()
