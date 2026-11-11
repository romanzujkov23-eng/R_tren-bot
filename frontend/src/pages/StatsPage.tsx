import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageTitle, Segmented } from '../components/ui'
import OverviewTab from './OverviewTab'
import BodyTab from './BodyTab'
import GoalsTab from './GoalsTab'
import MuscleSection from '../components/MuscleSection'

type Tab = 'overview' | 'muscles' | 'body' | 'goals'

export default function StatsPage() {
  const [params] = useSearchParams()
  const initial = params.get('tab')
  const [tab, setTab] = useState<Tab>(initial === 'goals' || initial === 'body' || initial === 'muscles' ? initial : 'overview')
  return (
    <div className="space-y-4">
      <PageTitle>Прогресс</PageTitle>
      <Segmented
        value={tab}
        options={[
          { value: 'overview', label: 'Обзор' },
          { value: 'muscles', label: 'Мышцы' },
          { value: 'body', label: 'Замеры' },
          { value: 'goals', label: 'Цели' },
        ]}
        onChange={setTab}
      />
      {tab === 'overview' ? <OverviewTab /> : tab === 'muscles' ? <MuscleSection /> : tab === 'body' ? <BodyTab /> : <GoalsTab />}
    </div>
  )
}
