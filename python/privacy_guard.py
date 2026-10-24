"""Last boundary: never send known Bilibili credentials as message text."""
import base64
import re
import unicodedata
from urllib.parse import quote, unquote


def assert_outgoing(text, credential):
    plain = unicodedata.normalize('NFKC', str(text))
    decoded = unquote(plain)
    compact = re.sub(r'[\s\u200b-\u200f\ufeff]', '', decoded)
    for key in ('sessdata', 'bili_jct', 'buvid3', 'buvid4', 'ac_time_value'):
        value = getattr(credential, key, '') or ''
        if not isinstance(value, str) or len(value) < 8:
            continue
        variants = [value, unquote(value), quote(value, safe=''), base64.b64encode(value.encode()).decode()]
        if any(v in plain or v in decoded or re.sub(r'\s', '', v) in compact for v in variants if len(v) >= 8):
            raise ValueError('CREDENTIAL_IN_TEXT')
    if re.search(r'(?i)\b(?:sessdata|bili_jct|access_token|api_key|authorization|cookie)\s*[:=]\s*\S{4,}', decoded):
        raise ValueError('CREDENTIAL_IN_TEXT')
