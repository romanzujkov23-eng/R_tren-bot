import { PageTitle } from '../components/ui'
import GoalsTab from './GoalsTab'


export default function GoalsPage() {
  return (
    <div className="space-y-4">
      <PageTitle>Цели</PageTitle>
      <GoalsTab />
    </div>
  )
}
