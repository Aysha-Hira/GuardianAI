from __future__ import annotations

import os


from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from auth.database import SessionLocal
from cameras.models import CameraRecord
from cameras.schemas import CameraCreate, CameraResponse, CameraUpdate

# Generate once with: Fernet.generate_key().decode()  -> put in .env
_fernet = Fernet(os.environ["CAMERA_ENCRYPTION_KEY"])


def _encrypt(url: str) -> str:
    return _fernet.encrypt(url.encode()).decode()


def _decrypt(token: str) -> str:
    return _fernet.decrypt(token.encode()).decode()


def list_cameras() -> list[CameraResponse]:
    with SessionLocal() as db:
        records = db.scalars(select(CameraRecord)).all()
        return [CameraResponse.model_validate(r) for r in records]


def get_camera(camera_id: int) -> CameraResponse | None:
    with SessionLocal() as db:
        record = db.get(CameraRecord, camera_id)
        return CameraResponse.model_validate(record) if record else None


def add_camera(payload: CameraCreate) -> CameraResponse:
    with SessionLocal() as db:
        record = CameraRecord(
            camera_name=payload.camera_name,
            source_type=payload.source_type,
            url_encrypted=_encrypt(payload.url or ""),
            is_active=payload.is_active,
        )
        db.add(record)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise ValueError("A camera with this name already exists")
        db.refresh(record)
        return CameraResponse.model_validate(record)


def update_camera(camera_id: int, payload: CameraUpdate) -> CameraResponse | None:
    with SessionLocal() as db:
        record = db.get(CameraRecord, camera_id)
        if record is None:
            return None
        data = payload.model_dump(exclude_unset=True)
        if "url" in data:
            record.url_encrypted = _encrypt(data.pop("url") or "")
        for field, value in data.items():
            setattr(record, field, value)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise ValueError("A camera with this name already exists")
        db.refresh(record)
        return CameraResponse.model_validate(record)


def delete_camera(camera_id: int) -> bool:
    with SessionLocal() as db:
        record = db.get(CameraRecord, camera_id)
        if record is None:
            return False
        db.delete(record)
        db.commit()
        return True


def get_stream_url(camera_id: int) -> str | None:
    """Decrypted URL. Internal use only (e.g. MediaService.start()). Never return via API."""
    with SessionLocal() as db:
        record = db.get(CameraRecord, camera_id)
        return _decrypt(record.url_encrypted) if record else None


def list_active_streams() -> list[tuple[int, str, str, str | None]]:
    """Internal only: (id, name, source_type, decrypted url)."""
    with SessionLocal() as db:
        records = db.scalars(
            select(CameraRecord).where(CameraRecord.is_active.is_(True))
        ).all()
        return [
            (r.id, r.camera_name, r.source_type, _decrypt(r.url_encrypted) or None)
            for r in records
        ]
