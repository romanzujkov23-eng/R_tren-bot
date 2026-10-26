from datetime import date, datetime, timedelta

from app.catalog import CATALOG, MUSCLES, muscle_split, split_muscles
from app.models import Workout

ASSIST_WEIGHT = 0.5
MAJOR_TARGET = 8.0
MINOR_TARGET = 4.0
MINOR = {"Предплечья", "Плечевая мышца", "Приводящие", "Косые мышцы живота", "Сгибатели бедра", "Трапеции", "Задние дельты"}
HINTS = 3


def default_targets() -> dict[str, float]:
    return {m: MINOR_TARGET if m in MINOR else MAJOR_TARGET for m in MUSCLES}


def workout_muscles(w: Workout) -> list[tuple[list[str], list[str], int, str]]:
    result = []
    for item in w.items:
        ex = item.exercise
        primary, secondary = muscle_split(ex.name, ex.muscle_group, ex.primary, ex.secondary)
        result.append((primary, secondary, item.target_sets, ex.name))
    return result


def program_targets(cycle: list[Workout]) -> dict[str, float]:
    targets: dict[str, float] = {}
    for w in cycle:
        for primary, secondary, sets, _ in workout_muscles(w):
            for m in primary:
                targets[m] = targets.get(m, 0) + sets
            for m in secondary:
                if m not in primary:
                    targets[m] = targets.get(m, 0) + sets * ASSIST_WEIGHT
    return {m: v for m, v in targets.items() if m in MUSCLES and v > 0}


def scale_targets(targets: dict[str, float], factor: float) -> dict[str, float]:
    if factor >= 1:
        return dict(targets)
    return {m: max(1.0, round(v * factor * 2) / 2) for m, v in targets.items()}


def cycle_window(day_count: int, sessions: list[datetime]) -> tuple[datetime | None, int, bool]:
    if day_count <= 0 or not sessions:
        return None, 0, False
    ordered = sorted(sessions)
    k = len(ordered) % day_count
    taken = k or day_count
    return ordered[-taken], taken, k == 0


def collect_loads(rows, in_window) -> dict[str, dict]:
    cache: dict[tuple, tuple[list[str], list[str]]] = {}
    stats: dict[str, dict] = {}
    for r in rows:
        when = in_window(r.finished_at)
        if when is None:
            continue
        key = (r.name, r.muscle_group, r.primary_muscles, r.secondary_muscles)
        if key not in cache:
            cache[key] = muscle_split(r.name, r.muscle_group, split_muscles(r.primary_muscles), split_muscles(r.secondary_muscles))
        primary, secondary = cache[key]
        for m in primary:
            st = stats.setdefault(m, {"sets": 0, "assist": 0, "last": when})
            st["sets"] += 1
            st["last"] = max(st["last"], when)
        for m in secondary:
            if m not in primary:
                st = stats.setdefault(m, {"sets": 0, "assist": 0, "last": when})
                st["assist"] += 1
                st["last"] = max(st["last"], when)
    return stats


def load_of(st: dict | None) -> float:
    return (st["sets"] + ASSIST_WEIGHT * st["assist"]) if st else 0.0


def percent_filled(stats: dict[str, dict], targets: dict[str, float]) -> int:
    total = sum(targets.values())
    if total <= 0:
        return 0
    done = sum(min(load_of(stats.get(m)), t) for m, t in targets.items())
    return int(round(done / total * 100))


def exercise_hints(cycle: list[Workout]) -> dict[str, list[str]]:
    hints: dict[str, list[str]] = {}
    for w in cycle:
        for primary, _, _, name in workout_muscles(w):
            for m in primary:
                if name not in hints.setdefault(m, []):
                    hints[m].append(name)
    for item in CATALOG:
        for m in item["primary"]:
            lst = hints.setdefault(m, [])
            if len(lst) < HINTS and item["name"] not in lst:
                lst.append(item["name"])
    return {m: v[:HINTS] for m, v in hints.items()}


def build_map(
    stats: dict[str, dict], targets: dict[str, float], hints: dict[str, list[str]], today: date, local_date,
) -> list[dict]:
    muscles = []
    for m in MUSCLES:
        st = stats.get(m)
        load = load_of(st)
        target = targets.get(m, 0.0)
        muscles.append({
            "name": m,
            "sets": st["sets"] if st else 0,
            "assist": st["assist"] if st else 0,
            "load": round(load, 1),
            "target": round(target, 1),
            "progress": round(min(load / target, 1.0), 3) if target > 0 else None,
            "last_days": (today - local_date(st["last"])).days if st else None,
            "hints": hints.get(m, []),
        })
    return muscles


def next_workout_muscles(w: Workout | None, muscles: list[dict]) -> dict | None:
    if w is None:
        return None
    open_names = {m["name"] for m in muscles if m["progress"] is not None and m["progress"] < 1}
    hit: list[str] = []
    for primary, _, _, _ in workout_muscles(w):
        for m in primary:
            if m in open_names and m not in hit:
                hit.append(m)
    return {"id": w.id, "name": w.name, "muscles": hit[:5]}


def week_bounds(today: date) -> tuple[date, date]:
    start = today - timedelta(days=today.weekday())
    return start, start + timedelta(days=6)
