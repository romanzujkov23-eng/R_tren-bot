from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import CATALOG_WORKOUTS_BY_ID, norm
from app.models import User, Workout, WorkoutExercise
from app.services import ensure_exercises


async def workout_for_catalog(db: AsyncSession, user: User, catalog_id: str) -> Workout | None:
    spec = CATALOG_WORKOUTS_BY_ID.get(catalog_id)
    if spec is None:
        return None

    existing = (
        await db.execute(select(Workout).where(Workout.user_id == user.id, Workout.program_id == catalog_id))
    ).scalars().first()
    if existing is not None:
        return existing

    exercises = await ensure_exercises(db, user, [name for name, _, _ in spec["items"]])
    workout = Workout(user_id=user.id, name=spec["name"], description=spec["description"] or None, program_id=catalog_id)
    workout.items = [
        WorkoutExercise(
            exercise_id=exercises[norm(name)].id,
            exercise=exercises[norm(name)],
            order_index=idx,
            target_sets=sets,
            target_reps=reps,
        )
        for idx, (name, sets, reps) in enumerate(spec["items"])
    ]
    db.add(workout)
    await db.flush()
    return workout
