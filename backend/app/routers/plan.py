from fastapi import APIRouter, Depends

from app.database import run_parallel
from app.models import User
from app.plan import build_plan, load_last_done, load_workouts
from app.security import get_current_user_ro

router = APIRouter()


@router.get("")
async def get_plan(user: User = Depends(get_current_user_ro)):
    workouts, last_done = await run_parallel(lambda s: load_workouts(s, user.id), lambda s: load_last_done(s, user.id))
    return build_plan(user.active_program, workouts, last_done)
