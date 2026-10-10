from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TelegramLogin(BaseModel):
    init_data: str


class UserOut(ORM):
    id: int
    telegram_id: int
    username: Optional[str] = None
    first_name: str
    app_mode: str = "full"
    active_program: Optional[str] = None
    timezone: str = "UTC"
    weekly_goal: int = 3
    reminder_enabled: bool = False
    reminder_time: str = "18:00"
    reminder_days: list[int] = []

    @field_validator("reminder_days", mode="before")
    @classmethod
    def _days(cls, v):
        if isinstance(v, str):
            return sorted(int(x) for x in v.split(",") if x.strip().isdigit())
        return v or []

    @field_validator("timezone", "reminder_time", mode="before")
    @classmethod
    def _none_to_default(cls, v, info):
        return v or ("UTC" if info.field_name == "timezone" else "18:00")

    @field_validator("weekly_goal", mode="before")
    @classmethod
    def _goal(cls, v):
        return v or 3

    @field_validator("reminder_enabled", mode="before")
    @classmethod
    def _enabled(cls, v):
        return bool(v)


class AuthOut(BaseModel):
    token: str
    user: UserOut
    is_new: bool = False


class UserUpdate(BaseModel):
    app_mode: Optional[str] = Field(None, pattern="^(simple|full)$")
    weekly_goal: Optional[int] = Field(None, ge=1, le=7)
    timezone: Optional[str] = Field(None, max_length=64)


class ReminderIn(BaseModel):
    enabled: bool
    time: str = Field(default="18:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    days: list[int] = Field(default=[0, 2, 4])

    @field_validator("days")
    @classmethod
    def _check_days(cls, v):
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("days must be 0..6")
        return sorted(set(v))


MUSCLE_GROUPS = ["chest", "back", "legs", "shoulders", "arms", "core", "cardio", "other"]


class ExerciseIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    muscle_group: str = Field(default="other", pattern="^(chest|back|legs|shoulders|arms|core|cardio|other)$")


class ExerciseOut(ORM):
    id: int
    name: str
    muscle_group: str


class WorkoutItemIn(BaseModel):
    exercise_id: int
    target_sets: int = Field(default=3, ge=1, le=20)
    target_reps: int = Field(default=10, ge=1, le=200)
    target_weight: Optional[float] = Field(default=None, ge=0, le=2000)


class WorkoutIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=1000)
    items: list[WorkoutItemIn] = []


class WorkoutItemOut(ORM):
    id: int
    exercise_id: int
    order_index: int
    target_sets: int
    target_reps: int
    target_weight: Optional[float] = None
    exercise: ExerciseOut


class WorkoutOut(ORM):
    id: int
    name: str
    description: Optional[str] = None
    items: list[WorkoutItemOut] = []


class SessionStart(BaseModel):
    workout_id: Optional[int] = None
    name: Optional[str] = Field(default=None, max_length=100)


class SetIn(BaseModel):
    exercise_id: int
    reps: int = Field(ge=1, le=1000)
    weight: float = Field(default=0, ge=0, le=2000)
    rpe: Optional[float] = Field(default=None, ge=1, le=10)


class SetOut(ORM):
    id: int
    exercise_id: int
    set_number: int
    reps: int
    weight: float
    rpe: Optional[float] = None
    volume: float
    est_1rm: float
    is_pr: bool
    exercise: ExerciseOut


class FinishIn(BaseModel):
    feeling: Optional[int] = Field(default=None, ge=1, le=5)
    note: Optional[str] = Field(default=None, max_length=500)


class SessionOut(ORM):
    id: int
    workout_id: Optional[int] = None
    name: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_seconds: int
    total_sets: int
    total_reps: int
    total_volume: float
    feeling: Optional[int] = None
    note: Optional[str] = None
    sets: list[SetOut] = []
    plan: list[WorkoutItemOut] = []


class SessionBrief(ORM):
    id: int
    name: str
    status: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_seconds: int
    total_sets: int
    total_volume: float
    feeling: Optional[int] = None


class BodyIn(BaseModel):
    day: Optional[date] = None
    weight: Optional[float] = Field(default=None, gt=0, le=700)
    waist: Optional[float] = Field(default=None, gt=0, le=400)
    chest: Optional[float] = Field(default=None, gt=0, le=400)
    hips: Optional[float] = Field(default=None, gt=0, le=400)
    arm: Optional[float] = Field(default=None, gt=0, le=200)
    thigh: Optional[float] = Field(default=None, gt=0, le=300)


class BodyOut(ORM):
    id: int
    measured_at: datetime
    weight: Optional[float] = None
    waist: Optional[float] = None
    chest: Optional[float] = None
    hips: Optional[float] = None
    arm: Optional[float] = None
    thigh: Optional[float] = None




KIND_PATTERN = "^(strength|cardio|stretch|sport|other|home|custom)$"
SUBTYPE_PATTERN = "^[a-z0-9_]{1,20}$"
COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"
MAX_MARKS_PER_DAY = 2


class DiaryIn(BaseModel):

    slot: int = Field(default=0, ge=0, le=MAX_MARKS_PER_DAY - 1)
    kind: str = Field(default="strength", pattern=KIND_PATTERN)
    subtype: Optional[str] = Field(default=None, pattern=SUBTYPE_PATTERN)
    emoji: Optional[str] = Field(default=None, max_length=16)
    color: Optional[str] = Field(default=None, pattern=COLOR_PATTERN)
    label: Optional[str] = Field(default=None, max_length=30)
    counts: bool = True
    note: Optional[str] = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _custom_needs_look(self):
        if self.kind == "custom" and not (self.emoji or "").strip() and not self.color:
            raise ValueError("Выберите смайлик или цвет")
        return self


class DiaryOut(ORM):
    id: int
    day: date
    slot: int = 0
    kind: str
    subtype: Optional[str] = None
    emoji: Optional[str] = None
    color: Optional[str] = None
    label: Optional[str] = None
    counts: bool = True
    note: Optional[str] = None


class GoalIn(BaseModel):
    kind: str = Field(pattern="^(body_weight|lift|monthly)$")
    target: float = Field(gt=0, le=2000)
    exercise_id: Optional[int] = None
    metric: str = Field(default="weight", pattern="^(weight|reps)$")
    deadline: Optional[date] = None

    @model_validator(mode="after")
    def _check(self):
        if self.kind == "lift" and not self.exercise_id:
            raise ValueError("Выберите упражнение")
        if self.kind == "monthly" and (self.target != int(self.target) or not 1 <= self.target <= 31):
            raise ValueError("Дней в месяце: от 1 до 31")
        if self.kind == "body_weight" and self.target > 700:
            raise ValueError("Некорректный вес")
        return self
