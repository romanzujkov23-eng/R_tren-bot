import { Link } from 'react-router-dom'
import { useAuth } from '../stores/authStore'
import { Card, PageTitle } from '../components/ui'
import Icon from '../components/Icon'

const FULL = [
  { title: 'Главная', text: 'Следующая тренировка по программе. Если тренировка уже идёт, будет кнопка «Продолжить».' },
  {
    title: 'План',
    text: 'Выбери программу из каталога или собери свою. Нажми на упражнение, и увидишь технику и работающие мышцы.',
  },
  {
    title: 'Тренировка',
    text: 'Записывай подходы, вес и повторы, для кардио дистанцию. В конце можно оценить самочувствие и оставить заметку.',
  },
  {
    title: 'Календарь',
    text: 'Отмечай дни видом тренировки, смайликом или цветом. В один день помещаются две тренировки и цвет. Нажми на число, и снизу откроется всё, что было в этот день. Значок личной тренировки можно сменить.',
  },
  { title: 'Прогресс', text: 'Графики, рекорды, замеры веса и цели.' },
  { title: 'Профиль', text: 'Цель на неделю, напоминания, оформление и смена режима.' },
]

const SIMPLE = [
  {
    title: 'Календарь',
    text: 'Нажми на день и отметь его. Можно выбрать вид тренировки, смайлик или цвет и добавить заметку.',
  },
  { title: 'Цели', text: 'Например, «12 тренировок в месяц». Прогресс считается сам.' },
  { title: 'Настройки', text: 'Цель на неделю, напоминания, оформление.' },
]

export default function HelpPage() {
  const simple = useAuth((s) => s.user?.app_mode === 'simple')
  const items = simple ? SIMPLE : FULL

  return (
    <div className="space-y-3">
      <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-brand">
        <Icon name="left" size={16} /> {simple ? 'Настройки' : 'Профиль'}
      </Link>
      <PageTitle>Как пользоваться</PageTitle>

      <Card className="space-y-1.5">
        <h2 className="font-semibold">Два режима</h2>
        <p className="text-sm text-hint">
          «Дневник» это календарь с отметками, без подходов и весов. «Полный режим» это программы, подходы, веса и
          статистика. Режим можно поменять в профиле.
        </p>
      </Card>

      <h2 className="px-1 pt-1 text-sm font-semibold text-hint">{simple ? 'Дневник' : 'Полный режим'}</h2>
      {items.map((i) => (
        <Card key={i.title} className="space-y-1.5">
          <h3 className="font-semibold">{i.title}</h3>
          <p className="text-sm text-hint">{i.text}</p>
        </Card>
      ))}
    </div>
  )
}
