"""Прогрессия жима лёжа: расчёт 9-недельного цикла по параметрам и результатам лифтера.

Основа методики (описание ниже пересказано своими словами, это не копия чужих программ):
- частота жима 2-4 раза в неделю: чем чаще жим при том же объёме, тем быстрее растёт сила;
- волнообразная нагрузка внутри недели: тяжёлый день, объёмный, лёгкий скоростной и вариация;
- нагрузка задаётся от расчётного максимума (1ПМ) и запаса повторов (RIR). Подбор по ощущениям
  в исследованиях работает не хуже процентов, а в среднем чуть лучше, поэтому вес пересчитывается
  после каждой тренировки по тому, как дались подходы;
- отдых 3-4 минуты на тяжёлых подходах: короткий отдых снижает прирост силы;
- три фазы: накопление (недели 1-3), интенсификация (4-6), пик (7), затем разгрузка (8) и тест (9).
"""

from __future__ import annotations

from dataclasses import dataclass

BENCH = "Жим штанги лёжа"
CLOSE_GRIP = "Жим штанги узким хватом"
BAR = 20.0
STEP = 2.5
WEEKS = 9
DAY_KINDS = {
    1: ["heavy"],  # один дополнительный тяжёлый день к любой программе, остальной объём даёт она
    2: ["heavy", "volume"],
    3: ["heavy", "volume", "speed"],
    4: ["heavy", "volume", "variation", "speed"],
}

PHASES = {
    1: ("Накопление", "Набираем объём и отрабатываем технику. Веса умеренные, запас повторов большой."),
    2: ("Накопление", "Объём растёт, запас повторов уменьшается."),
    3: ("Накопление", "Последняя неделя накопления: подходы тяжелее, но всё ещё с запасом."),
    4: ("Интенсификация", "Переходим к тяжёлым подходам с меньшим числом повторов."),
    5: ("Интенсификация", "Тяжёлые тройки. Следите за скоростью штанги."),
    6: ("Интенсификация", "Самые тяжёлые рабочие подходы цикла перед пиком."),
    7: ("Пик", "Тяжёлые одиночные подходы. Объём минимальный, всё внимание на качество."),
    8: ("Разгрузка", "Лёгкая неделя: организм восстанавливается и закрепляет прирост."),
    9: ("Тест", "Подводка и проверка нового максимума."),
}

# тяжёлый день: (повторы верхнего подхода, запас, подходов после него, повторов в них, снижение веса)
HEAVY = {
    1: (6, 3, 3, 6, 0.08),
    2: (5, 2, 3, 5, 0.08),
    3: (5, 1, 3, 5, 0.08),
    4: (4, 1, 3, 4, 0.07),
    5: (3, 1, 3, 3, 0.07),
    6: (2, 1, 3, 3, 0.08),
    7: (1, 1, 2, 2, 0.10),
}
# объёмный день: (подходов, повторов, запас)
VOLUME = {1: (4, 10, 3), 2: (4, 8, 3), 3: (4, 8, 2), 4: (4, 6, 2), 5: (4, 6, 2), 6: (3, 5, 2), 7: (3, 4, 3)}
# скоростной день: (подходов, повторов, доля от 1ПМ)
SPEED = {1: (6, 3, 0.62), 2: (6, 3, 0.64), 3: (6, 3, 0.66), 4: (5, 3, 0.68), 5: (5, 3, 0.70), 6: (5, 2, 0.72), 7: (4, 2, 0.72)}
# вариация: (упражнение, подходов, повторов, запас, коэффициент к жиму)
VARIATION = {
    1: ("close", 4, 8, 3, 0.88), 2: ("close", 4, 8, 2, 0.88), 3: ("close", 4, 6, 2, 0.88),
    4: ("pause", 4, 4, 2, 0.93), 5: ("pause", 4, 4, 2, 0.93), 6: ("pause", 3, 3, 2, 0.93),
    7: ("close", 3, 5, 3, 0.88),
}

ACCESSORIES = {
    "heavy": [("Тяга гантели одной рукой", 3, 10, "запас 2 повтора"), ("Разгибание рук на блоке", 3, 12, "запас 2 повтора")],
    "volume": [
        ("Жим гантелей на наклонной скамье", 3, 10, "запас 2 повтора"),
        ("Тяга верхнего блока", 3, 10, "запас 2 повтора"),
        ("Французский жим", 3, 10, "запас 2 повтора"),
    ],
    "speed": [("Тяга к лицу (face pull)", 3, 15, "легко, без отказа"), ("Разгибание рук на блоке", 3, 15, "запас 3 повтора")],
    "variation": [("Тяга штанги в наклоне", 3, 8, "запас 2 повтора"), ("Махи гантелей в стороны", 3, 15, "запас 2 повтора")],
    "deload": [("Тяга к лицу (face pull)", 2, 15, "очень легко")],
    "prep": [("Тяга к лицу (face pull)", 2, 15, "очень легко")],
    "test": [],
}

# расширенный день (один дополнительный день в неделю): после жима идёт вариация и подсобные,
# чтобы за единственную тренировку получить достаточный объём на грудь, трицепс, плечи и верх спины
# вариация: (подходов, повторов, запас, коэффициент к жиму)
EXT_SECONDARY = {
    1: (3, 8, 2, 0.88), 2: (3, 8, 2, 0.88), 3: (3, 6, 2, 0.88),
    4: (3, 6, 2, 0.90), 5: (3, 5, 2, 0.90), 6: (3, 4, 2, 0.90), 7: (2, 3, 3, 0.90),
}
EXT_ACC_MAIN = [
    ("Жим гантелей на наклонной скамье", 3, 10, "запас 2 повтора"),
    ("Разгибание рук на блоке", 3, 12, "запас 1-2 повтора"),
    ("Тяга гантели одной рукой", 3, 10, "запас 2 повтора"),
    ("Тяга к лицу (face pull)", 3, 15, "без отказа"),
]
EXT_ACC_PEAK = [
    ("Разгибание рук на блоке", 2, 12, "запас 2 повтора"),
    ("Тяга к лицу (face pull)", 3, 15, "без отказа"),
]


def ext_accessories(kind: str, week: int) -> list[tuple]:
    if kind == "heavy":
        return EXT_ACC_PEAK if week == 7 else EXT_ACC_MAIN
    return ACCESSORIES[kind]


REST = {"heavy": 210, "volume": 150, "speed": 120, "variation": 150, "deload": 90, "prep": 120, "test": 240}

ADDON_TIPS = [
    "Это дополнительный день к вашей программе: тренировки программы делайте как раньше.",
    "Порядок: сначала жим лёжа, затем узкий хват, потом подсобные. Если времени мало, пропускайте подсобные с конца.",
    "Ставьте его на день отдыха или через день после тренировки с жимом и грудью: между тяжёлыми жимами должно пройти около 48 часов.",
    "Жим в обычных тренировках делайте как раньше, но не до отказа и не тяжелее весов этого дня.",
    "Если в обычной тренировке стало тяжело жать или болят плечи, лучше убрать там один подход жима, чем пропустить этот день.",
]

TIPS = {
    "heavy": [
        "Разминка лесенкой без отказных повторов: она подводит нервную систему, а не утомляет.",
        "Верхний подход делайте чисто и быстро и остановитесь с запасом повторов, указанным в плане.",
        "Отдыхайте 3-4 минуты между рабочими подходами: при коротком отдыхе прирост силы ниже.",
        "Техника: лопатки сведены, ноги упёрты в пол, гриф опускается к нижней части груди.",
    ],
    "volume": [
        "Все подходы делайте одним весом. Если на последнем подходе запас меньше 1 повтора, в следующий раз снизьте вес на 2,5 кг.",
        "Отдых 2-3 минуты. Ритм опускания: примерно 2 секунды вниз, быстро вверх.",
        "Этот день делает основной вклад в рост мышц груди и трицепса, поэтому не торопитесь с весом.",
    ],
    "speed": [
        "Вес лёгкий намеренно: поднимайте штангу максимально взрывно, опускайте под контролем.",
        "Подходы должны быть без борьбы. Если скорость падает, значит вес выбран слишком большим.",
        "Этот день тренирует скорость старта и закрепляет технику без накопления усталости.",
    ],
    "variation": [
        "Вариация бьёт по слабым местам: узкий хват нагружает трицепс, пауза на груди убирает отскок.",
        "Пауза: гриф лежит на груди 1 секунду, затем жим без подскока.",
        "Вес в этом упражнении ниже, чем в обычном жиме, это нормально.",
    ],
    "deload": [
        "Это разгрузка, не пропуск. Работайте легко и взрывно, без отказа.",
        "Сон и питание сейчас важнее всего: именно в эту неделю закрепляется прирост.",
    ],
    "prep": [
        "Короткая лёгкая подводка перед тестом. Не добавляйте вес и повторы.",
        "Выспитесь накануне теста и поешьте за 2-3 часа до тренировки.",
    ],
    "test": [
        "Три попытки: первая лёгкая, вторая уверенная, третья на новый максимум. Отдых 4-5 минут.",
        "Просите страховку. Если вторая попытка далась тяжело, третью лучше не брать.",
        "Записывайте каждую попытку подходом на 1 повтор: так программа узнает новый результат.",
    ],
}

TITLES = {
    "heavy": "Тяжёлый день",
    "volume": "Объёмный день",
    "speed": "Скоростной день",
    "variation": "День вариации",
    "deload": "Разгрузка",
    "prep": "Подводка к тесту",
    "test": "Тест максимума",
}


def rnd(x: float) -> float:
    return round(x / STEP) * STEP


def pct(n: float) -> float:
    """Доля от 1ПМ, с которой можно сделать n повторов до отказа (формула Эпли)."""
    return 1.0 if n <= 1 else 1 / (1 + n / 30)


def e1rm_of(weight: float, reps: int) -> float:
    """Расчётный 1ПМ по подходу до отказа."""
    if weight <= 0:
        return 0.0
    return weight / pct(min(max(reps, 1), 12))


def load_for(e1rm: float, reps: int, rir: int) -> float:
    return e1rm * pct(reps + rir)


def warmup(first_weight: float) -> list[dict]:
    """Разминочная лесенка к первому рабочему весу."""
    steps = [(0.0, 10), (0.5, 5), (0.65, 3), (0.8, 2), (0.9, 1)]
    out: list[dict] = []
    for frac, reps in steps:
        w = BAR if frac == 0 else max(BAR, rnd(first_weight * frac))
        if w >= first_weight - 2.4 or (out and w <= out[-1]["weight"]):
            continue
        if frac == 0.9 and first_weight < 100:
            continue
        out.append({"weight": w, "reps": reps})
    return out


@dataclass
class Params:
    e1rm: float
    days: int
    volume_factor: float = 1.0


def total_days(days: int) -> int:
    return (WEEKS - 1) * days + 2


def schedule(days: int) -> list[tuple[int, int, str]]:
    """Последовательность тренировок цикла: (неделя, день, тип)."""
    kinds = DAY_KINDS[days]
    out: list[tuple[int, int, str]] = []
    for week in range(1, WEEKS + 1):
        if week == 8:
            out += [(week, d + 1, "deload") for d in range(days)]
        elif week == 9:
            out += [(9, 1, "prep"), (9, 2, "test")]
        else:
            out += [(week, d + 1, k) for d, k in enumerate(kinds)]
    return out


def _s(kind: str, weight: float, reps: int, rir: int | None, label: str) -> dict:
    return {"kind": kind, "weight": float(weight), "reps": int(reps), "rir": rir, "label": label}


def plan_day(week: int, day: int, kind: str, p: Params) -> dict:
    e = p.e1rm
    vf = p.volume_factor
    phase, focus = PHASES[week]
    main = BENCH
    main_note = ""
    sets: list[dict] = []

    if kind == "heavy":
        reps, rir, nb, br, drop = HEAVY[week]
        top = rnd(load_for(e, reps, rir))
        sets.append(_s("top", top, reps, rir, "Верхний подход"))
        back_w = rnd(top * (1 - drop))
        for _ in range(max(1, round(nb * vf))):
            sets.append(_s("backoff", back_w, br, None, "Подход со сниженным весом"))
    elif kind == "volume":
        n, reps, rir = VOLUME[week]
        w = rnd(load_for(e, reps, rir))
        sets = [_s("work", w, reps, rir, "Рабочий подход") for _ in range(max(2, round(n * vf)))]
    elif kind == "speed":
        n, reps, frac = SPEED[week]
        w = rnd(e * frac)
        sets = [_s("speed", w, reps, None, "Быстрый подход") for _ in range(max(3, round(n * vf)))]
        main_note = "Поднимайте штангу максимально быстро, опускайте под контролем."
    elif kind == "variation":
        which, n, reps, rir, k = VARIATION[week]
        w = rnd(load_for(e * k, reps, rir))
        sets = [_s("work", w, reps, rir, "Рабочий подход") for _ in range(n)]
        if which == "close":
            main = CLOSE_GRIP
            main_note = "Хват чуть уже плеч, локти ближе к корпусу."
        else:
            main_note = "Пауза 1 секунда на груди, затем жим без отскока."
    elif kind == "deload":
        w = rnd(e * 0.70)
        sets = [_s("deload", w, 3, None, "Лёгкий подход") for _ in range(3)]
        main_note = "Легко и взрывно, без отказа."
    elif kind == "prep":
        sets = [_s("deload", rnd(e * 0.80), 2, None, "Подводящий подход") for _ in range(3)]
        main_note = "Быстро и чисто, без усилия."
    else:  # test
        a1, a2, a3 = rnd(e * 0.93), rnd(e * 0.975), rnd(e * 1.015)
        a2 = max(a2, a1 + STEP)
        a3 = max(a3, a2 + STEP)
        sets = [_s("attempt", a1, 1, None, "Первая попытка"), _s("attempt", a2, 1, None, "Вторая попытка"), _s("attempt", a3, 1, None, "Третья попытка")]

    for st in sets:
        st["e"] = round(e, 1)  # максимум, от которого посчитан этот подход

    # при одном дополнительном дне даём полноценный объём: вариация и подсобные (расширенный день)
    rows = ext_accessories(kind, week) if p.days == 1 else ACCESSORIES[kind]
    accessories = [{"name": n, "sets": s, "reps": r, "note": note} for n, s, r, note in rows]

    secondary = None
    if p.days == 1 and kind == "heavy" and week in EXT_SECONDARY:
        n2, r2, rir2, k2 = EXT_SECONDARY[week]
        w2 = rnd(load_for(e * k2, r2, rir2))
        secondary = {
            "name": CLOSE_GRIP,
            "note": "Хват чуть уже плеч, локти ближе к корпусу. Нагружает трицепс и низ груди.",
            "sets": [_s("work", w2, r2, rir2, "Рабочий подход") for _ in range(n2)],
        }
    title = TITLES[kind]
    if kind == "variation":
        title += ": узкий хват" if main == CLOSE_GRIP else ": жим с паузой"
    return {
        "week": week,
        "day": day,
        "kind": kind,
        "title": title,
        "phase": phase,
        "focus": focus,
        "rest_seconds": REST[kind],
        "main": main,
        "main_note": main_note,
        "warmup": warmup(sets[0]["weight"]) if sets else [],
        "sets": sets,
        "secondary": secondary,
        "accessories": accessories,
        "tips": TIPS[kind] + (ADDON_TIPS if p.days == 1 else []),
    }


def evidence(plan_sets: list[dict], done: list[tuple[float, int, float | None]], kind: str) -> float | None:
    """Оценка 1ПМ по тому, как выполнен день. done: (вес, повторы, RPE) основного упражнения по порядку."""
    if kind not in ("heavy", "volume", "test") or not done:
        return None
    if kind == "test":
        best = max((e1rm_of(w, r) for w, r, _ in done if r <= 3 and w > 0), default=None)
        return best
    total = 0.0
    weight_sum = 0.0
    for planned, (w, r, rpe) in zip(plan_sets, done):
        if w <= 0 or planned["kind"] == "backoff":
            continue  # подходы со сниженным весом идут для объёма и не показывают форму
        rir_plan = planned.get("rir") or 0
        rir_done = (10 - rpe) if rpe is not None else rir_plan
        r = min(r, 15)  # защита от случайных опечаток: 50 повторов не должны считаться за форму
        base = planned.get("e")
        if base and planned["weight"] > 0:
            # сравниваем с планом: вес и повторы выше плана поднимают оценку, ниже опускают.
            # Округление веса до 2,5 кг так не даёт шума.
            est = base * (w / planned["weight"]) * pct(planned["reps"] + rir_plan) / pct(r + rir_done)
        else:
            est = w / pct(r + rir_done)
        k = 2.0 if planned["kind"] == "top" else 1.0
        total += est * k
        weight_sum += k
    return total / weight_sum if weight_sum else None


def adjust(e1rm: float, est: float | None, kind: str) -> float:
    """Пересчёт расчётного максимума: сдвигаем к оценке, но не больше чем на 3% за тренировку."""
    if est is None:
        return e1rm
    if kind == "test":
        return round(est, 1)
    diff = est - e1rm
    if abs(diff) < 0.02 * e1rm:
        return e1rm  # шум из-за округления веса до 2,5 кг и разброс формы
    step = max(-0.03 * e1rm, min(0.03 * e1rm, 0.5 * diff))
    return round(e1rm + step, 1)


def baseline(best_w: float, best_r: int, work_w: float, work_r: int, hist_e1rm: float | None) -> tuple[float, list[str]]:
    """Стартовый 1ПМ из лучшего жима, рабочего веса и недавней истории. Возвращает значение и пояснения."""
    notes: list[str] = []
    e_best = e1rm_of(best_w, best_r)
    e_work = e1rm_of(work_w, work_r)
    base = (e_best + e_work) / 2
    gap = abs(e_best - e_work) / max(e_best, e_work)
    if gap > 0.08:
        notes.append(
            f"Лучший жим даёт максимум около {e_best:.0f} кг, рабочий вес около {e_work:.0f} кг. "
            f"Разница {gap * 100:.0f}%: взяли среднее, программа сама подстроится после первых тренировок."
        )
    if hist_e1rm:
        if hist_e1rm > base * 1.03:
            base = (base + hist_e1rm) / 2
            notes.append(f"По истории тренировок вы сильнее, чем указано (оценка {hist_e1rm:.0f} кг). Стартовый максимум повышен.")
        elif hist_e1rm < base * 0.90:
            notes.append(f"В истории за последние недели результаты ниже указанных (оценка {hist_e1rm:.0f} кг). Если вы давно не жали, начальные веса могут казаться тяжёлыми.")
    return round(base, 1), notes


def default_week_sets(days: int) -> int:
    ref = Params(e1rm=100, days=days)
    return sum(len(plan_day(3, d, k, ref)["sets"]) for d, k in enumerate(DAY_KINDS[days], start=1))


def volume_factor(days: int, hist_weekly_sets: float | None) -> float:
    if days == 1 or not hist_weekly_sets:  # при одном дополнительном дне объём жима в основной программе не меняется
        return 1.0
    return round(max(0.75, min(1.2, hist_weekly_sets / default_week_sets(days))), 2)
