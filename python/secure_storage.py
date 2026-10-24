"""User-bound Windows DPAPI credentials; atomic private files elsewhere."""
import base64
import ctypes
import json
import os
from pathlib import Path
import uuid


def _dpapi(content, decrypt=False):
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    buffer = ctypes.create_string_buffer(content)
    source = Blob(len(content), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    local_free = ctypes.WinDLL('kernel32', use_last_error=True).LocalFree
    local_free.argtypes = [ctypes.c_void_p]; local_free.restype = ctypes.c_void_p
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ValueError('User-bound credential protection failed')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        local_free(ctypes.cast(target.data, ctypes.c_void_p))


def save(path, value):
    path = Path(path)
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError('Credential file cannot be a link or directory')
    raw = json.dumps(value, ensure_ascii=False).encode('utf-8')
    if os.name == 'nt':
        raw = json.dumps({'format': 'dpapi-v1', 'blob': base64.b64encode(_dpapi(raw)).decode('ascii')}).encode('ascii')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name('.credential-' + uuid.uuid4().hex + '.tmp')
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != 'nt':
            os.chmod(path, 0o600)
    finally:
        if temporary.exists():
            temporary.unlink()


def load(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
        raise ValueError('Credential storage is unavailable')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError('Credential storage has invalid format')
    if value.get('format') == 'dpapi-v1':
        if os.name != 'nt':
            raise ValueError('Credential belongs to a Windows user')
        decrypted = json.loads(_dpapi(base64.b64decode(value['blob'], validate=True), decrypt=True))
        if not isinstance(decrypted, dict):
            raise ValueError('Credential storage has invalid format')
        return decrypted
    if os.name == 'nt':
        save(path, value)
    elif path.stat().st_mode & 0o077:
        os.chmod(path, 0o600)
    return value
