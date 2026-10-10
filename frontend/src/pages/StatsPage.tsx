import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageTitle, Segmented } from '../components/ui'
import OverviewTab from './OverviewTab'
import BodyTab from './BodyTab'
import GoalsTab from './GoalsTab'

type Tab = 'overview' | 'body' | 'goals'

export default function StatsPage() {
  const [params] = useSearchParams()
  const initial = params.get('tab')
  const [tab, setTab] = useState<Tab>(initial === 'goals' || initial === 'body' ? initial : 'overview')
  return (
    <div className="space-y-4">
      <PageTitle>Прогресс</PageTitle>
      <Segmented
        value={tab}
        options={[
          { value: 'overview', label: 'Обзор' },
          { value: 'body', label: 'Замеры' },
          { value: 'goals', label: 'Цели' },
        ]}
        onChange={setTab}
      />
      {tab === 'overview' ? <OverviewTab /> : tab === 'body' ? <BodyTab /> : <GoalsTab />}
    </div>
  )
}
