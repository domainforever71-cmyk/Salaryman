"""Private image storage and picture-sharing regressions."""
import base64
import os
import sys
import tempfile

_tmp = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_tmp.name, "images.db").replace("\\", "/")
os.environ["SECRET_KEY"] = "image-test-secret"
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as A


def client(username):
    result = A.app.test_client()
    assert result.post(
        "/register", json={"username": username, "password": "secret1"}
    ).get_json()["success"]
    assert result.post(
        "/login", json={"username": username, "password": "secret1"}
    ).get_json()["success"]
    return result


sender = client("ImageSender")
recipient = client("ImageRecipient")
PNG = b"\x89PNG\r\n\x1a\n" + b"test-image-payload"
PNG_B64 = base64.b64encode(PNG).decode("ascii")

saved = sender.post("/api/images", json={
    "filename": "sample.png", "mime": "image/png", "data": PNG_B64,
})
assert saved.status_code == 201, saved.get_json()
image_id = saved.get_json()["image"]["id"]
assert sender.get("/api/images").get_json()["images"][0]["id"] == image_id
assert sender.get(f"/api/images/{image_id}/content").data == PNG
assert sender.get(f"/api/images/{image_id}/content").headers["Cache-Control"] == "private, no-store"
assert recipient.get(f"/api/images/{image_id}/content").status_code == 404
assert recipient.delete(f"/api/images/{image_id}").status_code == 404

bad_signature = sender.post("/api/images", json={
    "filename": "bad.png", "mime": "image/png",
    "data": base64.b64encode(b"not an image").decode("ascii"),
})
assert bad_signature.status_code == 400
too_large = sender.post("/api/images", json={
    "filename": "large.png", "mime": "image/png",
    "data": base64.b64encode(b"x" * (256 * 1024 + 1)).decode("ascii"),
})
assert too_large.status_code == 413

# Image-enabled AI paths report the provider requirement rather than quietly
# pretending the offline text fallback has actually inspected the picture.
original_available = A.ai.ai_available
A.ai.ai_available = lambda: False
try:
    failed = sender.post("/api/ai/command", json={
        "mode": "assistant", "prompt": "Describe it", "image_id": image_id,
    })
    assert failed.status_code == 503 and "vision-capable" in failed.get_json()["msg"]
finally:
    A.ai.ai_available = original_available

# DMs are open without friendship; pictures are stored as ordinary DM
# attachments, then made visible only to the two participants.
attached = sender.post("/api/messages/attach", json={
    "to": "ImageRecipient", "filename": "shared.png", "mime": "image/png",
    "data": PNG_B64, "body": "",
})
assert attached.status_code == 200, attached.get_json()
attachment_id = attached.get_json()["message"]["attachment"]["id"]
shared = recipient.get(f"/api/messages/attachment/{attachment_id}/content")
assert shared.status_code == 200 and shared.data == PNG
assert shared.headers["X-Content-Type-Options"] == "nosniff"
assert sender.post(
    f"/api/messages/attachment/{attachment_id}/content"
).status_code == 405
encrypted = sender.post("/api/messages/attach", json={
    "to": "ImageRecipient", "filename": "locked.png", "mime": "image/png",
    "data": PNG_B64, "encrypt": True, "pin": "1234",
})
assert encrypted.status_code == 200, encrypted.get_json()
locked_id = encrypted.get_json()["message"]["attachment"]["id"]
assert recipient.get(f"/api/messages/attachment/{locked_id}/content").status_code == 404
decrypted = recipient.post(
    f"/api/messages/attachment/{locked_id}",
    json={"pin": "1234"},
).get_json()
assert decrypted["success"] and base64.b64decode(decrypted["data"]) == PNG

assert sender.delete(f"/api/images/{image_id}").get_json()["success"]
assert sender.get(f"/api/images/{image_id}/content").status_code == 404

# The model request uses OpenAI's multimodal content shape without making a
# real network call.
class FakeResponse:
    def raise_for_status(self):
        pass

    def json(self):
        return {"choices": [{"message": {"content": "Seen."}}]}


original_post = A.ai.requests.post
captured = {}


def fake_post(url, **kwargs):
    captured.update(kwargs)
    return FakeResponse()


A.ai.requests.post = fake_post
try:
    assert A.ai._call_openai("system", "inspect", image_data_url="data:image/png;base64,AA==") == "Seen."
finally:
    A.ai.requests.post = original_post
assert captured["json"]["messages"][1]["content"][1]["type"] == "image_url"

print("Image storage and sharing checks passed.")
