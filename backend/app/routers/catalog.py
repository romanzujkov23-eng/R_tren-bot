from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.catalog import CATALOG, CATALOG_BY_NAME, PROGRAMS, PROGRAMS_BY_ID, norm
from app.database import get_db
from app.models import Exercise, User, Workout, WorkoutExercise
from app.security import get_current_user, get_current_user_ro

router = APIRouter()


@router.get("/catalog")
async def get_catalog(response: Response, _: User = Depends(get_current_user_ro)):
    response.headers["Cache-Control"] = "private, max-age=3600"
    return CATALOG


@router.get("/programs")
async def get_programs(response: Response, _: User = Depends(get_current_user_ro)):
    response.headers["Cache-Control"] = "private, max-age=3600"
    return [
        {
            "id": p["id"],
            "name": p["name"],
            "level": p["level"],
            "goal": p["goal"],
            "per_week": p["per_week"],
            "equipment": p["equipment"],
            "description": p["description"],
            "days": [
                {
                    "name": name,
                    "items": [
                        {"name": n, "sets": s, "reps": r, "muscles": CATALOG_BY_NAME[n.lower()]["muscles"]}
                        for n, s, r in items
                    ],
                }
                for name, items in p["days"]
            ],
        }
        for p in PROGRAMS
    ]


def _is_customized(w: Workout) -> bool:
    prog = PROGRAMS_BY_ID.get(w.program_id or "")
    if not prog or w.day_index is None or w.day_index >= len(prog["days"]):
        return True
    expected = [(norm(n), sets, reps) for n, sets, reps in prog["days"][w.day_index][1]]
    actual = [(norm(i.exercise.name), i.target_sets, i.target_reps) for i in w.items]
    return actual != expected or any(i.target_weight is not None for i in w.items)


@router.post("/programs/{program_id}/activate")
async def activate_program(
    program_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    prog = PROGRAMS_BY_ID.get(program_id)
    if not prog:
        raise HTTPException(404, "Программа не найдена")

    mine = (await db.execute(select(Workout).where(Workout.user_id == user.id))).scalars().all()
    stale_ids = {x for x in (user.active_program, program_id) if x}
    kept = 0
    for w in mine:
        if w.program_id in stale_ids:
            if _is_customized(w):
                src = PROGRAMS_BY_ID.get(w.program_id)
                w.description = f"Из программы «{src['name']}»" if src else None
                w.program_id, w.day_index = None, None
                kept += 1
            else:
                await db.delete(w)
    await db.flush()

    exercises = {
        norm(e.name): e
        for e in (await db.execute(select(Exercise).where(Exercise.user_id == user.id))).scalars()
    }
    for day_index, (day_name, items) in enumerate(prog["days"]):
        rows = []
        for idx, (name, sets, reps) in enumerate(items):
            ex = exercises.get(norm(name))
            if ex is None:
                ex = Exercise(user_id=user.id, name=name, muscle_group=CATALOG_BY_NAME[name.lower()]["group"])
                db.add(ex)
                await db.flush()
                exercises[norm(name)] = ex
            elif ex.is_archived:
                ex.is_archived = False
            rows.append(WorkoutExercise(exercise_id=ex.id, order_index=idx, target_sets=sets, target_reps=reps))
        w = Workout(
            user_id=user.id, name=day_name, description=prog["name"], program_id=program_id, day_index=day_index
        )
        w.items = rows
        db.add(w)
    user.active_program = program_id
    await db.commit()
    return {"created": len(prog["days"]), "kept": kept}
