import axios from 'axios'

const baseURL = import.meta.env.VITE_API_URL || '/api'

let token: string | null = null
let onUnauthorized: (() => Promise<boolean>) | null = null

export const setToken = (t: string | null) => {
  token = t
}
export const setUnauthorizedHandler = (fn: () => Promise<boolean>) => {
  onUnauthorized = fn
}

const http = axios.create({ baseURL, timeout: 30000 })

http.interceptors.request.use((cfg) => {
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

http.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config
    if (err.response?.status === 401 && onUnauthorized && cfg && !cfg._retry && !cfg.url?.includes('/auth/')) {
      cfg._retry = true
      if (await onUnauthorized()) {
        cfg.headers.Authorization = `Bearer ${token}`
        return http(cfg)
      }
    }
    const msg =
      err.response?.data?.error ||
      (Array.isArray(err.response?.data?.detail) ? 'Проверьте введённые данные' : null) ||
      (err.response ? 'Ошибка сервера' : 'Нет связи с сервером. Попробуйте ещё раз.')
    return Promise.reject(new Error(msg))
  },
)

export type MuscleGroup = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'cardio' | 'other'

export interface User {
  id: number
  telegram_id: number
  username: string | null
  first_name: string
  app_mode: 'simple' | 'full' | 'ask'
  active_program: string | null
  timezone: string
  weekly_goal: number
  reminder_enabled: boolean
  reminder_time: string
  reminder_days: number[]
}
export interface Exercise {
  id: number
  name: string
  muscle_group: MuscleGroup
}
export interface WorkoutItem {
  id: number
  exercise_id: number
  order_index: number
  target_sets: number
  target_reps: number
  target_weight: number | null
  exercise: Exercise
}
export interface Workout {
  id: number
  name: string
  description: string | null
  items: WorkoutItem[]
}
export interface WorkoutInput {
  name: string
  description?: string | null
  items: { exercise_id: number; target_sets: number; target_reps: number; target_weight: number | null }[]
}
export interface SetEntry {
  id: number
  exercise_id: number
  set_number: number
  reps: number
  weight: number
  rpe: number | null
  volume: number
  est_1rm: number
  is_pr: boolean
  exercise: Exercise
}
export interface Session {
  id: number
  workout_id: number | null
  name: string
  status: 'active' | 'completed'
  started_at: string
  finished_at: string | null
  duration_seconds: number
  total_sets: number
  total_reps: number
  total_volume: number
  feeling: number | null
  note: string | null
  sets: SetEntry[]
  plan: WorkoutItem[]
}
export interface SessionBrief {
  id: number
  name: string
  status: string
  started_at: string
  finished_at: string | null
  duration_seconds: number
  total_sets: number
  total_volume: number
  feeling: number | null
}
export interface Summary {
  total_workouts: number
  total_volume: number
  total_sets: number
  total_minutes: number
  workouts_this_week: number
}
export interface RecordRow {
  exercise_id: number
  name: string
  muscle_group: MuscleGroup
  best_weight: number
  best_1rm: number
  best_reps: number
}
export interface NextWorkout {
  id: number
  name: string
  exercises: number
  program_name: string
}
export interface Dashboard {
  streak: Streak
  summary: Summary
  next_workout: NextWorkout | null
  recent: SessionBrief[]
  active: { id: number; name: string; total_sets: number } | null
}
export interface Progress {
  exercise: { id: number; name: string }
  points: { date: string; max_weight: number; est_1rm: number; volume: number }[]
}

export interface Streak {
  weekly_goal: number
  this_week: number
  current: number
  best: number
}
export interface CatalogItem {
  name: string
  group: MuscleGroup
  equipment: string
  muscles: string
  primary: string[]
  secondary: string[]
  how: string[]
  tips: string[]
  images?: string[]
}
export interface Program {
  id: string
  name: string
  level: string
  goal: string
  per_week: number
  equipment: string
  description: string
  days: { name: string; items: { name: string; sets: number; reps: number; muscles: string }[] }[]
}
export interface Suggestion {
  last: { date: string; sets: { weight: number; reps: number }[] } | null
  suggested: { weight: number; reps: number; reason: string } | null
}
export interface BodyValues {
  day?: string
  weight?: number | null
  waist?: number | null
  chest?: number | null
  hips?: number | null
  arm?: number | null
  thigh?: number | null
}
export interface BodyEntry extends BodyValues {
  id: number
  measured_at: string
}

export type DiaryKind = 'strength' | 'cardio' | 'stretch' | 'sport' | 'other' | 'home' | 'custom'
export interface DiaryEntry {
  id: number
  day: string
  slot: number
  kind: DiaryKind
  subtype: string | null
  emoji: string | null
  color: string | null
  label: string | null
  counts: boolean
  note: string | null
}
export interface MarkInput {
  slot: number
  kind: DiaryKind
  subtype?: string | null
  emoji?: string | null
  color?: string | null
  label?: string | null
  counts?: boolean
  note?: string | null
}
export interface DiaryWorkout {
  id: number
  day: string
  name: string
  sets: number
  minutes: number
  volume: number
  feeling: number | null
  note: string | null
}
export interface DiaryMonth {
  month: string
  entries: DiaryEntry[]
  workouts: DiaryWorkout[]
  marked_days: number
  streak: Streak
}

export interface PlanExercise {
  exercise_id: number
  name: string
  muscle_group: MuscleGroup
  muscles: string
  sets: number
  reps: number
  weight: number | null
}
export interface PlanDay {
  workout_id: number
  name: string
  day_index: number | null
  last_done: string | null
  exercises: PlanExercise[]
}
export interface Plan {
  program: {
    id: string
    name: string
    level: string
    description: string
    next_workout_id: number
    days: PlanDay[]
  } | null
  own: PlanDay[]
}

export type GoalKind = 'body_weight' | 'lift' | 'monthly'
export interface Goal {
  id: number
  kind: GoalKind
  title: string
  exercise_id: number | null
  exercise_name: string | null
  metric: 'weight' | 'reps'
  target: number
  start: number | null
  current: number
  unit: string
  progress: number
  achieved: boolean
  achieved_at: string | null
  deadline: string | null
  created_at: string
}
export interface GoalInput {
  kind: GoalKind
  target: number
  exercise_id?: number
  metric?: 'weight' | 'reps'
  deadline?: string | null
}

export interface KpiPair {
  value: number
  prev: number
}
export interface Overview {
  weeks: number
  kpi: { workouts: KpiPair; volume: KpiPair; sets: KpiPair; minutes: KpiPair; avg_minutes: KpiPair; per_week: KpiPair }
  weekly: { week: string; workouts: number; volume: number; sets: number }[]
  muscles: { name: string; sets: number; share: number }[]
  exercises: {
    exercise_id: number
    name: string
    sessions: number
    best_weight: number
    best_reps: number
    best_1rm: number
    first_1rm: number
    last_1rm: number
    delta_1rm: number | null
    best_date: string
  }[]
}

const d = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const api = {
  loginTelegram: (init_data: string) =>
    d<{ token: string; user: User }>(http.post('/auth/telegram', { init_data })),
  loginDev: () => d<{ token: string; user: User }>(http.post('/auth/dev')),

  updateMe: (body: Partial<{ app_mode: 'simple' | 'full'; weekly_goal: number; timezone: string }>) =>
    d<User>(http.put('/users/me', body)),
  setReminders: (body: { enabled: boolean; time: string; days: number[] }) =>
    d<User>(http.put('/users/me/reminders', body)),
  deleteMe: () => http.delete('/users/me'),

  exercises: () => d<Exercise[]>(http.get('/exercises')),
  createExercise: (body: { name: string; muscle_group: MuscleGroup }) =>
    d<Exercise>(http.post('/exercises', body)),
  deleteExercise: (id: number) => http.delete(`/exercises/${id}`),
  suggestion: (id: number, targetReps?: number) =>
    d<Suggestion>(http.get(`/exercises/${id}/suggestion`, { params: targetReps ? { target_reps: targetReps } : {} })),

  catalog: () => d<CatalogItem[]>(http.get('/catalog')),
  programs: () => d<Program[]>(http.get('/programs')),
  activateProgram: (id: string) => d<{ created: number }>(http.post(`/programs/${id}/activate`)),
  plan: () => d<Plan>(http.get('/plan')),

  goals: () => d<Goal[]>(http.get('/goals')),
  createGoal: (body: GoalInput) => d<{ id: number }>(http.post('/goals', body)),
  deleteGoal: (id: number) => http.delete(`/goals/${id}`),

  body: () => d<BodyEntry[]>(http.get('/body')),
  addBody: (v: BodyValues) => d<BodyEntry>(http.post('/body', v)),
  deleteBody: (id: number) => http.delete(`/body/${id}`),
  diary: (month: string) => d<DiaryMonth>(http.get('/diary', { params: { month } })),
  markDay: (day: string, body: MarkInput) => d<DiaryEntry>(http.put(`/diary/${day}`, body)),
  unmarkDay: (day: string, slot?: number) => http.delete(`/diary/${day}`, { params: slot === undefined ? {} : { slot } }),

  workouts: () => d<Workout[]>(http.get('/workouts')),
  workout: (id: number) => d<Workout>(http.get(`/workouts/${id}`)),
  createWorkout: (body: WorkoutInput) => d<Workout>(http.post('/workouts', body)),
  updateWorkout: (id: number, body: WorkoutInput) => d<Workout>(http.put(`/workouts/${id}`, body)),
  deleteWorkout: (id: number) => http.delete(`/workouts/${id}`),

  startSession: (body: { workout_id?: number; name?: string }) => d<Session>(http.post('/sessions', body)),
  activeSession: () => d<Session | null>(http.get('/sessions/active')),
  addSet: (id: number, body: { exercise_id: number; reps: number; weight: number }) =>
    d<Session>(http.post(`/sessions/${id}/sets`, body)),
  deleteSet: (id: number, setId: number) => d<Session>(http.delete(`/sessions/${id}/sets/${setId}`)),
  finishSession: (id: number, body: { feeling?: number; note?: string }) =>
    d<Session>(http.post(`/sessions/${id}/finish`, body)),
  discardSession: (id: number) => http.delete(`/sessions/${id}`),
  session: (id: number) => d<Session>(http.get(`/sessions/${id}`)),
  history: (limit = 30) => d<SessionBrief[]>(http.get('/sessions', { params: { limit } })),

  dashboard: () => d<Dashboard>(http.get('/statistics/dashboard')),
  overview: (weeks: number) => d<Overview>(http.get('/statistics/overview', { params: { weeks } })),
  records: () => d<RecordRow[]>(http.get('/statistics/records')),
  progress: (exerciseId: number) => d<Progress>(http.get(`/statistics/progress/${exerciseId}`)),
}
