from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    username: Mapped[Optional[str]] = mapped_column(String(64))
    first_name: Mapped[str] = mapped_column(String(128), default="")
    last_name: Mapped[Optional[str]] = mapped_column(String(128))
    language_code: Mapped[Optional[str]] = mapped_column(String(10))

    weight_unit: Mapped[str] = mapped_column(String(4), default="kg")
    default_rest_seconds: Mapped[int] = mapped_column(Integer, default=90)
    rest_timer_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    app_mode: Mapped[str] = mapped_column(String(10), default="full")
    active_program: Mapped[Optional[str]] = mapped_column(String(20))

    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    weekly_goal: Mapped[int] = mapped_column(Integer, default=3)
    reminder_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    reminder_time: Mapped[str] = mapped_column(String(5), default="18:00")
    reminder_days: Mapped[str] = mapped_column(String(20), default="0,2,4")
    reminder_last_date: Mapped[Optional[str]] = mapped_column(String(10))

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_active_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    muscle_group: Mapped[str] = mapped_column(String(32), default="other")
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Workout(Base):

    __tablename__ = "workouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text)
    program_id: Mapped[Optional[str]] = mapped_column(String(20), index=True)
    day_index: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    items: Mapped[list["WorkoutExercise"]] = relationship(
        cascade="all, delete-orphan", order_by="WorkoutExercise.order_index", lazy="selectin"
    )


class WorkoutExercise(Base):
    __tablename__ = "workout_exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    workout_id: Mapped[int] = mapped_column(ForeignKey("workouts.id", ondelete="CASCADE"), index=True)
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id", ondelete="CASCADE"))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    target_sets: Mapped[int] = mapped_column(Integer, default=3)
    target_reps: Mapped[int] = mapped_column(Integer, default=10)
    target_weight: Mapped[Optional[float]] = mapped_column(Float)

    exercise: Mapped[Exercise] = relationship(lazy="joined")


class WorkoutSession(Base):

    __tablename__ = "workout_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    workout_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workouts.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)

    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)

    total_sets: Mapped[int] = mapped_column(Integer, default=0)
    total_reps: Mapped[int] = mapped_column(Integer, default=0)
    total_volume: Mapped[float] = mapped_column(Float, default=0)

    feeling: Mapped[Optional[int]] = mapped_column(Integer)
    note: Mapped[Optional[str]] = mapped_column(String(500))

    sets: Mapped[list["CompletedSet"]] = relationship(
        cascade="all, delete-orphan", order_by="CompletedSet.id", lazy="selectin"
    )


class CompletedSet(Base):
    __tablename__ = "completed_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("workout_sessions.id", ondelete="CASCADE"), index=True
    )
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id", ondelete="CASCADE"), index=True)
    set_number: Mapped[int] = mapped_column(Integer, default=1)
    reps: Mapped[int] = mapped_column(Integer)
    weight: Mapped[float] = mapped_column(Float, default=0)
    rpe: Mapped[Optional[float]] = mapped_column(Float)
    volume: Mapped[float] = mapped_column(Float, default=0)
    est_1rm: Mapped[float] = mapped_column(Float, default=0)
    is_pr: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    exercise: Mapped[Exercise] = relationship(lazy="joined")


class BodyMeasurement(Base):
    __tablename__ = "body_measurements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    measured_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    weight: Mapped[Optional[float]] = mapped_column(Float)
    waist: Mapped[Optional[float]] = mapped_column(Float)
    chest: Mapped[Optional[float]] = mapped_column(Float)
    hips: Mapped[Optional[float]] = mapped_column(Float)
    arm: Mapped[Optional[float]] = mapped_column(Float)
    thigh: Mapped[Optional[float]] = mapped_column(Float)


class DiaryEntry(Base):

    __tablename__ = "diary_entries"
    __table_args__ = (UniqueConstraint("user_id", "day", name="uq_diary_user_day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(16), default="strength")
    subtype: Mapped[Optional[str]] = mapped_column(String(20))
    note: Mapped[Optional[str]] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    migrated: Mapped[bool] = mapped_column(Boolean, default=False)


class DayMark(Base):

    __tablename__ = "day_marks"
    __table_args__ = (UniqueConstraint("user_id", "day", "slot", name="uq_daymark_user_day_slot"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    day: Mapped[date] = mapped_column(Date, index=True)
    slot: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(16), default="strength")
    subtype: Mapped[Optional[str]] = mapped_column(String(20))
    emoji: Mapped[Optional[str]] = mapped_column(String(16))
    color: Mapped[Optional[str]] = mapped_column(String(7))
    label: Mapped[Optional[str]] = mapped_column(String(30))
    counts: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[Optional[str]] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Goal(Base):

    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    exercise_id: Mapped[Optional[int]] = mapped_column(ForeignKey("exercises.id", ondelete="SET NULL"))
    metric: Mapped[str] = mapped_column(String(8), default="weight")
    target: Mapped[float] = mapped_column(Float)
    start_value: Mapped[Optional[float]] = mapped_column(Float)
    deadline: Mapped[Optional[date]] = mapped_column(Date)
    achieved_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
