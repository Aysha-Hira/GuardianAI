from datetime import datetime
from pydantic import BaseModel, ConfigDict
from typing import Literal

SourceType = Literal["webcam", "rtsp", "http"]

class CameraCreate(BaseModel):
    camera_name: str
    source_type: SourceType
    url: str | None = None
    is_active: bool = False

class CameraUpdate(BaseModel):
    camera_name: str | None = None
    source_type: SourceType | None = None
    url: str | None = None
    is_active: bool | None = None

class CameraResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    camera_name: str
    source_type: str
    is_active: bool
    created_at: datetime
    updated_at: datetime