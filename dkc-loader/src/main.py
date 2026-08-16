from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from collections import Counter
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
    data = json.loads(
        CONFIG_PATH.read_text(encoding="utf-8")
    )

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
        state = json.loads(
            STATE_PATH.read_text(encoding="utf-8")
        )
    else:
        state = {}

    state.setdefault("visited", [])
    state.setdefault("product_urls", [])
    state.setdefault("product_completed_urls", [])
    state.setdefault("product_errors", [])
    state.setdefault("product_skip_reasons", {})
    state.setdefault("product_skipped_urls", [])
    state.setdefault("errors", 0)
    state.setdefault("pages", 0)

    return state


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    temp_path = STATE_PATH.with_suffix(".tmp")

    temp_path.write_text(
        json.dumps(
            state,
            ensure_ascii=False,
            indent=2
        ),
        encoding="utf-8"
    )

    temp_path.replace(STATE_PATH)


def append_jsonl(
    path: Path,
    item: dict
) -> None:
    path.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    with path.open(
        "a",
        encoding="utf-8"
    ) as f:
        f.write(
            json.dumps(
                item,
                ensure_ascii=False
            ) + "\n"
        )


def load_saved_product_urls() -> set[str]:
    result: set[str] = set()

    if not PRODUCTS_PATH.exists():
        return result

    try:
        with PRODUCTS_PATH.open(
            "r",
            encoding="utf-8"
        ) as f:

            for line in f:
                line = line.strip()

                if not line:
                    continue

                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue

                url = item.get("source_url")

                if url:
                    result.add(url)

    except OSError:
        pass

    return result


class RateLimiter:

    def __init__(self, delay: float):
        self.delay = delay
        self.lock = asyncio.Lock()
        self.last_request = 0.0

    async def wait(self) -> None:
        async with self.lock:

            now = time.monotonic()

            wait_for = (
                self.delay
                - (now - self.last_request)
            )

            if wait_for > 0:
                await asyncio.sleep(wait_for)

            self.last_request = time.monotonic()


class RobotsPolicy:

    def __init__(
        self,
        client: httpx.AsyncClient,
        user_agent: str
    ):
        self.client = client
        self.user_agent = user_agent
        self.parsers: dict[
            str,
            RobotFileParser | None
        ] = {}

    async def allowed(
        self,
        url: str
    ) -> bool:

        parsed = urlparse(url)

        origin = (
            f"{parsed.scheme}://"
            f"{parsed.netloc}"
        )

        if origin not in self.parsers:

            robots_url = (
                f"{origin}/robots.txt"
            )

            try:

                response = await self.client.get(
                    robots_url
                )

                if response.status_code >= 400:

                    self.parsers[origin] = None

                else:

                    rp = RobotFileParser()

                    rp.set_url(robots_url)

                    rp.parse(
                        response.text.splitlines()
                    )

                    self.parsers[origin] = rp

            except httpx.HTTPError:

                self.parsers[origin] = None
                return False

        rp = self.parsers[origin]

        if rp is None:
            return False

        return rp.can_fetch(
            self.user_agent,
            url
        )


class DKCParser:
    """
    Parser for DKC catalog.
    """

    def __init__(
        self,
        root_url: str
    ):

        parsed = urlparse(root_url)

        self.root_prefix = (
            parsed.path.rstrip("/")
            + "/"
        )

        self.root_url = (
            root_url.rstrip("/")
            + "/"
        )

    def in_scope(
        self,
        url: str
    ) -> bool:

        parsed = urlparse(url)

        if parsed.scheme not in {
            "http",
            "https"
        }:
            return False

        if parsed.netloc not in {
            "www.dkc.ru",
            "dkc.ru"
        }:
            return False

        path = (
            parsed.path.rstrip("/")
            + "/"
        )

        return (
            path == self.root_prefix
            or path.startswith(
                self.root_prefix
            )
        )

    @staticmethod
    def is_service_url(
        url: str
    ) -> bool:

        path = urlparse(
            url
        ).path.lower()

        return any(
            part in path
            for part in (
                "/compare.php",
                "/sale/",
                "/search/",
                "/search.php",
            )
        )

    @staticmethod
    def normalize_text(
        text: str
    ) -> str:

        return re.sub(
            r"\s+",
            " ",
            text
        ).strip()

    @staticmethod
    def is_catalog_page(
        url: str
    ) -> bool:

        path = urlparse(
            url
        ).path.rstrip("/")

        return path == "/ru/catalog/2095"

    @staticmethod
    def is_assembled_cqe_title(
        title: str | None
    ) -> bool:

        if not title:
            return False

        normalized = (
            DKCParser.normalize_text(
                title
            ).lower()
        )

        return (
            normalized.startswith(
                "напольный собранный корпус cqe n"
            )
            or normalized.startswith(
                "корпуса напольные cqe n"
            )
        )

    @staticmethod
    def is_excluded_product(
        soup: BeautifulSoup,
        title: str | None
    ) -> tuple[bool, str | None]:

        page_text = (
            DKCParser.normalize_text(
                soup.get_text(
                    " ",
                    strip=True
                )
            ).lower()
        )

        title_text = (
            DKCParser.normalize_text(
                title or ""
            ).lower()
        )

        text = (
            f"{title_text} {page_text}"
        )

        exclusion_markers = (
            "архивный",
            "архив",
            "снят с производства",
            "снято с производства",
            "не производится",
            "старая версия",
            "старой версии",
            "замена на",
            "заменен на",
            "заменён на",
            "взамен",
        )

        for marker in exclusion_markers:

            if marker in text:
                return True, f"excluded:{marker}"

        return False, None

    @staticmethod
    def extract_title(
        soup: BeautifulSoup
    ) -> str | None:

        # DKC currently does not necessarily use H1.
        # Product name is available in <title>.

        title_tag = soup.find("title")

        if title_tag:

            title = (
                DKCParser.normalize_text(
                    title_tag.get_text(
                        " ",
                        strip=True
                    )
                )
            )

            # Remove DKC site suffix.
            title = re.sub(
                r"\s+от российского производителя ДКС\s*\|\s*DKC\s*$",
                "",
                title,
                flags=re.IGNORECASE
            )

            title = re.sub(
                r"\s*\|\s*DKC\s*$",
                "",
                title,
                flags=re.IGNORECASE
            )

            if title:
                return title

        # Fallback to H1.
        h1 = soup.find("h1")

        if h1:

            title = (
                DKCParser.normalize_text(
                    h1.get_text(
                        " ",
                        strip=True
                    )
                )
            )

            if title:
                return title

        return None

    @staticmethod
    def extract_article(
        soup: BeautifulSoup
    ) -> str | None:

        # Primary DKC structure:
        #
        # <div class="catalogCard__article">
        #     Код:
        #     <span class="js-article-item">
        #         R5A21
        #     </span>
        # </div>

        article_node = soup.select_one(
            ".catalogCard__article .js-article-item"
        )

        if article_node:

            article = (
                DKCParser.normalize_text(
                    article_node.get_text(
                        " ",
                        strip=True
                    )
                )
            )

            # Remove any accidental nested text.
            article = re.sub(
                r"\s+",
                "",
                article
            )

            if len(article) >= 3:
                return article

        # Secondary DKC-compatible method.
        article_container = soup.select_one(
            ".catalogCard__article"
        )

        if article_container:

            text = (
                DKCParser.normalize_text(
                    article_container.get_text(
                        " ",
                        strip=True
                    )
                )
            )

            match = re.search(
                r"\bКод\s*[:№]?\s*"
                r"([A-Za-zА-Яа-я0-9._-]{3,})",
                text,
                re.IGNORECASE
            )

            if match:
                return match.group(1)

        # Generic fallback.
        text = (
            DKCParser.normalize_text(
                soup.get_text(
                    " ",
                    strip=True
                )
            )
        )

        match = re.search(
            r"\bКод\s*[:№]?\s*"
            r"([A-Za-zА-Яа-я0-9._-]{3,})",
            text,
            re.IGNORECASE
        )

        if match:
            return match.group(1)

        return None

    @staticmethod
    def extract_etim(
        soup: BeautifulSoup
    ) -> dict[str, str]:

        result: dict[str, str] = {}

        heading = None

        for tag in soup.find_all(
            [
                "h2",
                "h3",
                "h4",
                "div",
                "span"
            ]
        ):

            text = (
                DKCParser.normalize_text(
                    tag.get_text(
                        " ",
                        strip=True
                    )
                )
            )

            if (
                "характеристики по стандарту etim"
                in text.lower()
            ):

                heading = tag
                break

        if not heading:
            return result

        container = heading.parent

        if not container:
            return result

        rows = container.find_all("tr")

        for row in rows:

            cells = [
                DKCParser.normalize_text(
                    c.get_text(
                        " ",
                        strip=True
                    )
                )
                for c in row.find_all(
                    ["th", "td"]
                )
            ]

            if (
                len(cells) >= 2
                and cells[0]
                and cells[1]
            ):

                result[cells[0]] = cells[1]

        if result:
            return result

        for item in container.find_all(
            ["dt", "dd"]
        ):

            if item.name != "dt":
                continue

            key = (
                DKCParser.normalize_text(
                    item.get_text(
                        " ",
                        strip=True
                    )
                )
            )

            value = item.find_next_sibling(
                "dd"
            )

            if key and value:

                result[key] = (
                    DKCParser.normalize_text(
                        value.get_text(
                            " ",
                            strip=True
                        )
                    )
                )

        return result

    @staticmethod
    def extract_image(
        soup: BeautifulSoup,
        page_url: str
    ) -> str | None:

        selectors = [
            'meta[property="og:image"]',
            'meta[name="twitter:image"]',
            'img[itemprop="image"]',
        ]

        for selector in selectors:

            tag = soup.select_one(
                selector
            )

            if not tag:
                continue

            value = (
                tag.get("content")
                or tag.get("src")
            )

            if value:
                return urljoin(
                    page_url,
                    value
                )

        return None

    def parse_product(
        self,
        html: str,
        url: str
    ) -> tuple[dict | None, str]:

        soup = BeautifulSoup(
            html,
            "lxml"
        )

        if self.is_catalog_page(url):

            return None, "catalog_page"

        title = self.extract_title(
            soup
        )

        if not title:

            return None, "missing_title"

        if self.is_assembled_cqe_title(
            title
        ):

            return None, "excluded_cqe_n"

        excluded, reason = (
            self.is_excluded_product(
                soup,
                title
            )
        )

        if excluded:

            return None, (
                reason
                or "excluded"
            )

        article = self.extract_article(
            soup
        )

        if not article:

            return None, "missing_article"

        product = {
            "source": "DKC",
            "source_url": url,
            "name": title,
            "article": article,
            "characteristics": (
                self.extract_etim(
                    soup
                )
            ),
        }

        image_url = (
            self.extract_image(
                soup,
                url
            )
        )

        if image_url:
            product["image_url"] = image_url

        return product, "ok"


async def fetch(
    client: httpx.AsyncClient,
    limiter: RateLimiter,
    robots: RobotsPolicy,
    url: str,
    cfg: Config
) -> str:

    if (
        cfg.respect_robots_txt
        and not await robots.allowed(url)
    ):

        raise PermissionError(
            "robots.txt does not permit "
            f"crawling: {url}"
        )

    last_error = None

    for attempt in range(
        cfg.max_retries + 1
    ):

        try:

            await limiter.wait()

            response = await client.get(
                url,
                follow_redirects=True
            )

            response.raise_for_status()

            return response.text

        except (
            httpx.HTTPError,
            httpx.TimeoutException
        ) as exc:

            last_error = repr(exc)

            if attempt < cfg.max_retries:

                await asyncio.sleep(
                    2 ** attempt
                )

    raise RuntimeError(
        last_error
        or "request failed"
    )


async def crawl(
    cfg: Config
) -> None:

    state = load_state()

    visited = set(
        state.get(
            "visited",
            []
        )
    )

    product_urls = set(
        state.get(
            "product_urls",
            []
        )
    )

    completed_urls = set(
        state.get(
            "product_completed_urls",
            []
        )
    )

    product_errors = set(
        state.get(
            "product_errors",
            []
        )
    )

    skip_reasons = dict(
        state.get(
            "product_skip_reasons",
            {}
        )
    )

    parser = DKCParser(
        cfg.start_urls[0]
    )

    saved_product_urls = (
        load_saved_product_urls()
    )

    completed_urls.update(
        saved_product_urls
    )

    state[
        "product_completed_urls"
    ] = sorted(
        completed_urls
    )

    save_state(state)

    limiter = RateLimiter(
        cfg.request_delay_seconds
    )

    headers = {
        "User-Agent": cfg.user_agent,
        "Accept-Language": "ru,en;q=0.5",
    }

    timeout = httpx.Timeout(
        cfg.timeout_seconds
    )

    print(
        "DKC Loader starting...",
        flush=True
    )

    print(
        f"Scope: {parser.root_url}",
        flush=True
    )

    print(
        f"Existing visited pages: "
        f"{len(visited)}",
        flush=True
    )

    print(
        f"Existing product URLs: "
        f"{len(product_urls)}",
        flush=True
    )

    print(
        f"Already saved products: "
        f"{len(completed_urls)}",
        flush=True
    )

    print(
        f"Request delay: "
        f"{cfg.request_delay_seconds}s | "
        f"robots.txt: "
        f"{cfg.respect_robots_txt}",
        flush=True
    )

    async with httpx.AsyncClient(
        headers=headers,
        timeout=timeout
    ) as client:

        robots = RobotsPolicy(
            client,
            cfg.user_agent
        )

        # -----------------------------------------------------
        # Discovery only if product URLs are missing.
        # -----------------------------------------------------

        if not product_urls:

            queue = list(
                cfg.start_urls
            )

            print(
                "Starting discovery...",
                flush=True
            )

            while (
                queue
                and len(visited)
                < cfg.max_pages
            ):

                url = queue.pop(0)

                if (
                    url in visited
                    or not parser.in_scope(url)
                    or parser.is_service_url(url)
                ):
                    continue

                print(
                    f"[DISCOVERY] {url}",
                    flush=True
                )

                try:

                    html = await fetch(
                        client,
                        limiter,
                        robots,
                        url,
                        cfg
                    )

                    visited.add(url)

                    state["pages"] = len(
                        visited
                    )

                    catalog_links, _ = (
                        parser.parse_links(
                            html,
                            url
                        )
                    )

                    product, reason = (
                        parser.parse_product(
                            html,
                            url
                        )
                    )

                    if product is not None:

                        product_urls.add(
                            url
                        )

                        print(
                            "  PRODUCT: "
                            f"{product['article']} | "
                            f"{product['name']}",
                            flush=True
                        )

                    else:

                        print(
                            "  navigation/category "
                            f"page | links: "
                            f"{len(catalog_links)} | "
                            f"reason: {reason}",
                            flush=True
                        )

                    for link in sorted(
                        catalog_links
                    ):

                        if (
                            link not in visited
                            and link not in queue
                        ):

                            queue.append(link)

                except Exception as exc:

                    state["errors"] = (
                        state.get(
                            "errors",
                            0
                        ) + 1
                    )

                    append_jsonl(
                        ERRORS_PATH,
                        {
                            "url": url,
                            "stage": "discovery",
                            "error": repr(exc),
                        }
                    )

                    print(
                        f"  ERROR: {exc!r}",
                        flush=True
                    )

                state["visited"] = sorted(
                    visited
                )

                state["product_urls"] = sorted(
                    product_urls
                )

                save_state(state)

            print(
                "Discovery finished: "
                f"{len(visited)} pages, "
                f"{len(product_urls)} "
                "product pages",
                flush=True
            )

        else:

            print(
                "Discovery skipped: existing "
                "product_urls found in state.json",
                flush=True
            )

        # -----------------------------------------------------
        # Process products.
        # -----------------------------------------------------

        remaining_urls = sorted(
            product_urls
            - completed_urls
        )

        print(
            f"Products to process: "
            f"{len(remaining_urls)}",
            flush=True
        )

        successful = 0
        skipped = 0
        failed = 0

        for index, url in enumerate(
            remaining_urls,
            start=1
        ):

            print(
                f"[PRODUCT {index}/"
                f"{len(remaining_urls)}] "
                f"{url}",
                flush=True
            )

            try:

                html = await fetch(
                    client,
                    limiter,
                    robots,
                    url,
                    cfg
                )

                product, reason = (
                    parser.parse_product(
                        html,
                        url
                    )
                )

                if product is not None:

                    if not cfg.dry_run:

                        append_jsonl(
                            PRODUCTS_PATH,
                            product
                        )

                        completed_urls.add(
                            url
                        )

                        product_errors.discard(
                            url
                        )

                        successful += 1

                        print(
                            "  SAVED: "
                            f"{product['article']} | "
                            f"{product['name']}",
                            flush=True
                        )

                    else:

                        print(
                            "  DRY RUN: "
                            "product not written",
                            flush=True
                        )

                else:

                    skipped += 1

                    skip_reasons[url] = (
                        reason
                    )

                    print(
                        f"  SKIPPED: {reason}",
                        flush=True
                    )

            except Exception as exc:

                failed += 1

                product_errors.add(
                    url
                )

                append_jsonl(
                    ERRORS_PATH,
                    {
                        "url": url,
                        "stage": "product",
                        "error": repr(exc),
                    }
                )

                print(
                    f"  ERROR: {exc!r}",
                    flush=True
                )

            state[
                "visited"
            ] = sorted(
                visited
            )

            state[
                "product_urls"
            ] = sorted(
                product_urls
            )

            state[
                "product_completed_urls"
            ] = sorted(
                completed_urls
            )

            state[
                "product_errors"
            ] = sorted(
                product_errors
            )

            state[
                "product_skip_reasons"
            ] = skip_reasons

            state[
                "product_skipped_urls"
            ] = sorted(
                skip_reasons.keys()
            )

            state[
                "pages"
            ] = len(
                visited
            )

            save_state(state)

        print(
            "",
            flush=True
        )

        print(
            "PRODUCT PROCESSING FINISHED",
            flush=True
        )

        print(
            f"Total product URLs: "
            f"{len(product_urls)}",
            flush=True
        )

        print(
            f"Successfully saved this run: "
            f"{successful}",
            flush=True
        )

        print(
            f"Skipped this run: "
            f"{skipped}",
            flush=True
        )

        print(
            f"Errors this run: "
            f"{failed}",
            flush=True
        )

        print(
            f"Total saved products: "
            f"{len(completed_urls)}",
            flush=True
        )

        print(
            f"Remaining errors: "
            f"{len(product_errors)}",
            flush=True
        )

        if skip_reasons:

            counts = Counter(
                skip_reasons.values()
            )

            print(
                "",
                flush=True
            )

            print(
                "SKIP REASONS:",
                flush=True
            )

            for reason, count in (
                counts.most_common()
            ):

                print(
                    f"  {reason}: {count}",
                    flush=True
                )

    save_state(state)

    print(
        "DKC Loader finished.",
        flush=True
    )


def main() -> None:

    parser = argparse.ArgumentParser(
        description="DKC catalog loader"
    )

    parser.add_argument(
        "--live",
        action="store_true",
        help=(
            "write extracted products "
            "to output/products.jsonl"
        )
    )

    parser.add_argument(
        "--fresh",
        action="store_true",
        help=(
            "ignore previous crawl state "
            "and start from configured root"
        )
    )

    args = parser.parse_args()

    cfg = load_config()

    if args.live:
        cfg.dry_run = False

    if (
        args.fresh
        and STATE_PATH.exists()
    ):

        STATE_PATH.unlink()

        print(
            "Previous state.json removed. "
            "Starting fresh discovery.",
            flush=True
        )

    asyncio.run(
        crawl(cfg)
    )


if __name__ == "__main__":
    main()