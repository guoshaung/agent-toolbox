import json
import socket
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

DEFAULT_WX_BASE = "http://127.0.0.1:8075"
DEFAULT_ADMIN_KEY = "gucheng"


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_json(path: Path, data: dict[str, Any]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=4), encoding="utf-8")


class WeChatLoginClient:
    def __init__(self, data_path: Path, wx_base: str = DEFAULT_WX_BASE, admin_key: str = DEFAULT_ADMIN_KEY):
        self.data_path = data_path
        self.wx_base = wx_base.rstrip("/")
        self.admin_key = admin_key

    def load(self) -> dict[str, Any]:
        data = _load_json(self.data_path)
        data.setdefault("wx_key", "")
        data.setdefault("proxy", "")
        data.setdefault("profile", {})
        return data

    def save(self, data: dict[str, Any]):
        _save_json(self.data_path, data)

    def is_alive(self, timeout: float = 0.5) -> bool:
        p = urlparse(self.wx_base)
        host = p.hostname or "127.0.0.1"
        port = p.port or (443 if p.scheme == "https" else 80)
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            return False

    def request(self, method: str, path: str, key: str, json_body: dict[str, Any] | None = None) -> dict[str, Any]:
        with httpx.Client(timeout=30) as client:
            response = client.request(method, f"{self.wx_base}{path}", params={"key": key}, json=json_body)
            response.raise_for_status()
            return response.json()

    def create_device(self, proxy: str = "") -> tuple[bool, str]:
        try:
            data = self.request("POST", "/admin/GenAuthKey3", self.admin_key, {"Count": 1, "Type": 365})
            if data.get("Code") != 200 or not data.get("Data"):
                return False, data.get("Text", "创建设备失败")
            wx_key = str(data["Data"][0])
            self.save({"wx_key": wx_key, "proxy": proxy, "profile": {}})
            return True, wx_key
        except Exception as exc:
            return False, f"创建设备失败: {exc}"

    def qrcode(self, way: str = "") -> tuple[bool, str]:
        data = self.load()
        wx_key = data.get("wx_key") or ""
        if not wx_key:
            return False, "请先创建设备"
        try:
            response = self.request(
                "POST",
                "/login/GetLoginQrCodeNewX",
                wx_key,
                {"Check": False, "Proxy": data.get("proxy") or "", "Way": way},
            )
            qr_url = (response.get("Data") or {}).get("QrCodeUrl", "")
            if not qr_url:
                return False, response.get("Text", "获取二维码失败")
            return True, qr_url
        except Exception as exc:
            return False, f"获取二维码失败: {exc}"

    def status(self) -> tuple[bool, bool, int, str]:
        data = self.load()
        wx_key = data.get("wx_key") or ""
        if not wx_key:
            return False, False, 0, "请先创建设备"
        try:
            response = self.request("GET", "/login/GetLoginStatus", wx_key)
            if response.get("Code") != 200:
                return False, False, 0, response.get("Text") or f"Code {response.get('Code')}"
            state = int((response.get("Data") or {}).get("loginState", 0))
            return True, state == 1, state, ""
        except Exception as exc:
            return False, False, 0, str(exc)

    def profile(self) -> tuple[bool, dict[str, str], str]:
        data = self.load()
        wx_key = data.get("wx_key") or ""
        if not wx_key:
            return False, {}, "请先创建设备"
        try:
            response = self.request("GET", "/user/GetProfile", wx_key)
            info = (response.get("Data") or {}).get("userInfo", {})
            profile = {
                "wxid": (info.get("userName") or {}).get("str", ""),
                "nickname": (info.get("nickName") or {}).get("str", ""),
            }
            data["profile"] = profile
            self.save(data)
            return True, profile, ""
        except Exception as exc:
            return False, {}, str(exc)

    def _contacts_path(self) -> Path:
        return self.data_path.parent / "wechat_contacts.json"

    def load_contacts(self) -> list[dict[str, Any]]:
        data = _load_json(self._contacts_path())
        return data.get("contacts") or []

    def sync_contacts(self) -> tuple[bool, int, str]:
        data = self.load()
        wx_key = data.get("wx_key") or ""
        if not wx_key:
            return False, 0, "请先创建设备"
        try:
            wxids: list[str] = []
            wx_seq = 0
            room_seq = 0
            for _ in range(50):
                resp = self.request(
                    "POST",
                    "/friend/GetContactList",
                    wx_key,
                    {"CurrentWxcontactSeq": wx_seq, "CurrentChatRoomContactSeq": room_seq},
                )
                cl = (resp.get("Data") or {}).get("ContactList") or {}
                wxids += cl.get("contactUsernameList") or []
                wx_seq = cl.get("currentWxcontactSeq", 0)
                room_seq = cl.get("currentChatRoomContactSeq", 0)
                if not cl.get("continueFlag"):
                    break

            friend_ids = [w for w in wxids if not w.endswith("@chatroom")]
            group_ids = [w for w in wxids if w.endswith("@chatroom")]

            contacts: list[dict[str, Any]] = []
            for i in range(0, len(friend_ids), 20):
                d = self.request(
                    "POST",
                    "/friend/GetContactDetailsList",
                    wx_key,
                    {"UserNames": friend_ids[i:i + 20], "RoomWxIDList": []},
                )
                for c in (d.get("Data") or {}).get("contactList") or []:
                    wxid = (c.get("userName") or {}).get("str", "")
                    if not wxid:
                        continue
                    contacts.append({
                        "wxid": wxid,
                        "nickname": (c.get("nickName") or {}).get("str", ""),
                        "remark": (c.get("remark") or {}).get("str", ""),
                        "avatar": c.get("smallHeadImgUrl") or "",
                        "label_ids": str(c.get("labelIdlist") or "").strip(),
                    })

            for i in range(0, len(group_ids), 20):
                d = self.request(
                    "POST",
                    "/group/GetChatRoomInfo",
                    wx_key,
                    {"ChatRoomWxIdList": group_ids[i:i + 20]},
                )
                for c in (d.get("Data") or {}).get("contactList") or []:
                    wxid = ((c.get("userName") or {}).get("str") or "").strip()
                    if not wxid:
                        continue
                    contacts.append({
                        "wxid": wxid,
                        "nickname": ((c.get("nickName") or {}).get("str") or "").strip(),
                        "remark": "",
                        "avatar": c.get("smallHeadImgUrl") or "",
                        "label_ids": "",
                    })

            _save_json(self._contacts_path(), {"contacts": contacts})
            return True, len(contacts), ""
        except Exception as exc:
            return False, 0, str(exc)

    def get_group_names(self, chat_keys: list[str]) -> tuple[bool, dict[str, dict[str, str]], str]:
        """批量拉群名，返回 dict[chat_key, {name, avatar}]。"""
        if not chat_keys:
            return True, {}, ""
        data = self.load()
        wx_key = data.get("wx_key") or ""
        if not wx_key:
            return False, {}, "请先创建设备"
        try:
            out: dict[str, dict[str, str]] = {}
            for i in range(0, len(chat_keys), 20):
                d = self.request(
                    "POST",
                    "/group/GetChatRoomInfo",
                    wx_key,
                    {"ChatRoomWxIdList": chat_keys[i:i + 20]},
                )
                for c in (d.get("Data") or {}).get("contactList") or []:
                    ck = ((c.get("userName") or {}).get("str") or "").strip()
                    name = ((c.get("nickName") or {}).get("str") or "").strip()
                    if ck and name:
                        out[ck] = {"name": name, "avatar": c.get("smallHeadImgUrl") or ""}
            return True, out, ""
        except Exception as exc:
            return False, {}, str(exc)

    def get_group_members(self, chat_key: str) -> tuple[bool, dict[str, str], str]:
        """单群拉成员列表，返回 dict[wxid, nickname]。"""
        data = self.load()
        wx_key = data.get("wx_key") or ""
        if not wx_key:
            return False, {}, "请先创建设备"
        try:
            resp = self.request(
                "POST",
                "/group/GetChatroomMemberDetail",
                wx_key,
                {"ChatRoomName": chat_key},
            )
            md = (resp.get("Data") or {}).get("member_data") or {}
            out: dict[str, str] = {}
            for m in md.get("chatroom_member_list") or []:
                wxid = (m.get("user_name") or "").strip()
                if wxid:
                    out[wxid] = (m.get("nick_name") or "").strip()
            return True, out, ""
        except Exception as exc:
            return False, {}, str(exc)

    def logout(self) -> tuple[bool, str]:
        data = self.load()
        wx_key = data.get("wx_key") or ""
        if not wx_key:
            return False, "请先创建设备"
        try:
            response = self.request("GET", "/login/LogOut", wx_key)
            if response.get("Code") != 200:
                return False, response.get("Text") or f"Code {response.get('Code')}"
            data["profile"] = {}
            self.save(data)
            return True, response.get("Text", "已退出微信")
        except Exception as exc:
            return False, f"退出失败: {exc}"
