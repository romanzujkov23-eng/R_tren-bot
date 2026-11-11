import json
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, run_parallel
from app.extras import program_key
from app.models import ProgramOrder, User
from app.extras import load_extras, load_order
from app.plan import build_plan, load_custom, load_last_done, load_recent, load_workouts
from app.security import get_current_user, get_current_user_ro

router = APIRouter()


@router.get("")
async def get_plan(user: User = Depends(get_current_user_ro)):
    workouts, last_done, custom, recent, extras, order = await run_parallel(
        lambda s: load_workouts(s, user.id),
        lambda s: load_last_done(s, user.id),
        lambda s: load_custom(s, user.id, user.active_program),
        lambda s: load_recent(s, user.id),
        lambda s: load_extras(s, user),
        lambda s: load_order(s, user),
    )
    return build_plan(user.active_program, workouts, last_done, custom, recent, extras, order)


class OrderIn(BaseModel):
    order: list[str] = Field(max_length=60)


@router.put("/order")
async def set_order(body: OrderIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Свой порядок дней в круге: ключи дней программы («w<id>») и дополнительных дней («x<id>»)."""
    if not user.active_program:
        raise HTTPException(400, "Сначала выберите программу")
    if len(set(body.order)) != len(body.order) or not all(re.fullmatch(r"[wx]\d{1,12}", k) for k in body.order):
        raise HTTPException(400, "Неверный порядок дней")
    row = (
        await db.execute(select(ProgramOrder).where(ProgramOrder.user_id == user.id, ProgramOrder.program_key == program_key(user)))
    ).scalars().first()
    if row is None:
        db.add(ProgramOrder(user_id=user.id, program_key=program_key(user), order_json=json.dumps(body.order)))
    else:
        row.order_json = json.dumps(body.order)
    await db.commit()
    return {"order": body.order}


@router.delete("/order", status_code=204)
async def reset_order(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(ProgramOrder).where(ProgramOrder.user_id == user.id, ProgramOrder.program_key == program_key(user)))
    await db.commit()
