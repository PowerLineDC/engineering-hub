from __future__ import annotations

import argparse
import asyncio
import json
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

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


class DKCParser:
    """Conservative parser: extracts only values explicitly present in page HTML."""

    def __init__(self, base_url: str):
        self.base_url = base_url

    def parse_links(self, html: str, page_url: str) -> tuple[set[str], set[str]]:
        soup = BeautifulSoup(html, "lxml")
        catalog_links: set[str] = set()
        product_links: set[str] = set()
        for a in soup.find_all("a", href=True):
            url = urljoin(page_url, a["href"]).split("#", 1)[0]
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"}:
                continue
            if parsed.netloc not in {"www.dkc.ru", "dkc.ru"}:
                continue
            if "/catalog/" not in parsed.path:
                continue
            # Product pages on DKC contain an article-like final path segment.
            parts = [p for p in parsed.path.split("/") if p]
            if len(parts) >= 3 and parts[-1] not in {"catalog"} and parts[-1] != parts[-2]:
                product_links.add(url)
            else:
                catalog_links.add(url)
        return catalog_links, product_links

    def parse_product(self, html: str, url: str) -> tuple[dict, list[dict]]:
        soup = BeautifulSoup(html, "lxml")
        title = soup.find("h1")
        text = soup.get_text(" ", strip=True)
        article = None
        # Do not infer article numbers from arbitrary text. Accept only an explicit
        # "Код" label followed by a value in nearby page text.
        code_labels = soup.find_all(string=lambda s: s and "Код" in s.strip())
        for label in code_labels:
            parent_text = label.parent.get_text(" ", strip=True) if label.parent else ""
            if parent_text.startswith("Код") and len(parent_text.split()) >= 2:
                article = parent_text.split("Код", 1)[1].strip().strip(":")
                if article:
                    break

        product = {
            "source": "DKC",
            "source_url": url,
            "name": title.get_text(" ", strip=True) if title else None,
            "article": article,
            "characteristics": {},
        }

        incomplete = []
        if product["name"] is None:
            incomplete.append("name")
        if product["article"] is None:
            incomplete.append("article")
        if incomplete:
            return product, [{"source_url": url, "missing_fields": incomplete}]
        return product, []


async def fetch(client: httpx.AsyncClient, limiter: RateLimiter, url: str, cfg: Config) -> str:
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
    semaphore = asyncio.Semaphore(cfg.max_concurrency)

    headers = {"User-Agent": cfg.user_agent, "Accept-Language": "ru,en;q=0.5"}
    timeout = httpx.Timeout(cfg.timeout_seconds)

    async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
        while queue and len(visited) < cfg.max_pages:
            url = queue.pop(0)
            if url in visited:
                continue
            parsed = urlparse(url)
            if parsed.netloc not in cfg.allowed_hosts:
                continue

            try:
                async with semaphore:
                    html = await fetch(client, limiter, url, cfg)
                visited.add(url)
                state["pages"] = len(visited)
                catalog_links, found_products = parser.parse_links(html, url)
                product_urls.update(found_products)
                for link in sorted(catalog_links):
                    if link not in visited and link not in queue:
                        queue.append(link)
            except Exception as exc:
                state["errors"] = state.get("errors", 0) + 1
                append_jsonl(ERRORS_PATH, {"url": url, "error": repr(exc)})

            state["visited"] = sorted(visited)
            state["product_urls"] = sorted(product_urls)
            save_state(state)

    # Product extraction is deliberately separate from discovery so the parser can
    # be validated against real DKC pages before mass-writing the Engineering Hub data.
    for url in sorted(product_urls):
        try:
            async with semaphore:
                html = await fetch(client, limiter, url, cfg)
            product, incomplete = parser.parse_product(html, url)
            if incomplete:
                for item in incomplete:
                    append_jsonl(INCOMPLETE_PATH, item)
            if not cfg.dry_run:
                append_jsonl(PRODUCTS_PATH, product)
        except Exception as exc:
            append_jsonl(ERRORS_PATH, {"url": url, "stage": "product", "error": repr(exc)})

    save_state(state)


def main() -> None:
    parser = argparse.ArgumentParser(description="DKC catalog loader")
    parser.add_argument("--live", action="store_true", help="write extracted products to output/products.jsonl")
    args = parser.parse_args()
    cfg = load_config()
    if args.live:
        cfg.dry_run = False
    asyncio.run(crawl(cfg))


if __name__ == "__main__":
    main()
