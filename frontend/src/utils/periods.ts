export const PERIODS = [
  { value: 1, label: '1 нед', prev: 'предыдущей недели', text: 'за неделю' },
  { value: 3, label: '3 нед', prev: 'предыдущих 3 недель', text: 'за 3 недели' },
  { value: 6, label: '6 нед', prev: 'предыдущих 6 недель', text: 'за 6 недель' },
  { value: 13, label: '3 мес', prev: 'предыдущих 3 месяцев', text: 'за 3 месяца' },
] as const

export const periodOf = (weeks: number) => PERIODS.find((p) => p.value === weeks) ?? PERIODS[0]
