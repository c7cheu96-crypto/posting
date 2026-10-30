"""posting_MMDD 저장소의 오늘 맛집 글(영어판)을 Blogger에 게시합니다."""
import json, os, sys, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta

def fail(msg):
    print(f"::error::{msg}"); sys.exit(1)

for k in ("BLOGGER_CLIENT_ID", "BLOGGER_CLIENT_SECRET", "BLOGGER_REFRESH_TOKEN"):
    if not os.environ.get(k):
        fail(f"Secret {k} 이 비어 있어요. posting 저장소 Settings > Secrets and variables > Actions 에 등록해 주세요.")

BLOG_ID = os.environ["BLOGGER_BLOG_ID"]
OWNER = os.environ.get("OWNER", "c7cheu96-crypto")
today = datetime.now(timezone(timedelta(hours=9)))
explicit = os.environ.get("TARGET_REPO")
# 지정 저장소가 없으면: 오늘 저장소 → 실패 시 posting 저장소(대체 저장 위치) 순서로 확인
candidates = [explicit] if explicit else ["posting_" + today.strftime("%m%d"), "posting"]
TODAY = today.strftime("%Y-%m-%d")
draft = os.environ.get("DRAFT", "false") == "true"

def http(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:400]
        raise RuntimeError(f"HTTP {e.code} {url.split('?')[0]} :: {body}") from None

def raw(repo, path):
    return http(f"https://raw.githubusercontent.com/{OWNER}/{repo}/main/{urllib.parse.quote(path)}")

items = []
for repo in candidates:
    try:
        latest = raw(repo, "posts/latest.json")
    except Exception as e:
        print(f"{repo}: posts/latest.json 없음"); continue
    if not explicit and latest.get("date") != TODAY:
        print(f"{repo}: 오늘({TODAY}) 글이 아님 — 건너뜀"); continue
    items += [(repo, it) for it in latest.get("posts", [])]
if not items:
    print("게시할 글이 없어요."); sys.exit(0)

try:
  token = http("https://oauth2.googleapis.com/token", urllib.parse.urlencode({
    "client_id": os.environ["BLOGGER_CLIENT_ID"],
    "client_secret": os.environ["BLOGGER_CLIENT_SECRET"],
    "refresh_token": os.environ["BLOGGER_REFRESH_TOKEN"],
    "grant_type": "refresh_token"}).encode())["access_token"]
except Exception as e:
    fail(f"구글 토큰 발급 실패: {e}".replace("\n", " "))
auth = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
api = f"https://www.googleapis.com/blogger/v3/blogs/{BLOG_ID}/posts"

existing = set()
for status in ("live", "draft"):
    try:
        res = http(f"{api}?maxResults=50&status={status}&fields=items(title)", headers=auth)
        existing |= {p["title"] for p in res.get("items", [])}
    except Exception:
        pass

published = 0
for repo, item in items:
    post = raw(repo, item["url"])
    en = post.get("en")
    if not en:
        print(f"건너뜀: {item['name']} (영어판 없음 — 경제 글이거나 예전 형식)"); continue
    if en["title"] in existing:
        print(f"건너뜀: 이미 게시됨 — {en['title']}"); continue
    body = json.dumps({"kind": "blogger#post", "title": en["title"],
                       "content": en["html"], "labels": en.get("labels", [])}).encode()
    try:
        res = http(f"{api}/?isDraft={'true' if draft else 'false'}", data=body, headers=auth, method="POST")
    except Exception as e:
        fail(f"Blogger 게시 실패: {e}".replace("\n", " "))
    print(f"::notice::게시 완료({'초안' if draft else '공개'}): {en['title']} → {res.get('url') or res.get('id')}")
    published += 1
print(f"{published}개 게시")
