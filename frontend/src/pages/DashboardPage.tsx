import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { init, use as useECharts } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { io } from 'socket.io-client'
import { ApiError, api, authToken } from '../api/client'
import type {
  AuthSession,
  AlarmRecord,
  CustomerRecord,
  LocalUser,
  RepairCrewRecord,
  ServiceRequest as ApiServiceRequest,
  SupportConversation,
  SupportMessage as ApiSupportMessage,
  UserRole,
} from '../api/client'
import type { TelemetrySample } from '../types/grid'
import AuthPage from './AuthPage'
import {
  Activity,
  AlertTriangle,
  Banknote,
  Bell,
  Cable,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Clock3,
  Download,
  Gauge,
  Headset,
  LayoutDashboard,
  LogOut,
  Map,
  MessageCircle,
  Menu,
  MoreHorizontal,
  Power,
  Send,
  Sparkles,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
  Wrench,
  Zap,
} from 'lucide-react'

const NetworkMapView = lazy(() => import('../network-map/NetworkMapView'))
useECharts([LineChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer])

type Station = {
  id: string
  name: string
  location: string
  voltage: string
  load: number
  status: 'normal' | 'warning' | 'critical'
}

type Incident = {
  id: string
  title: string
  detail: string
  equipmentId: string
  time: string
  severity: 'critical' | 'warning' | 'info'
  acknowledged: boolean
}

type QualityEventSummary = {
  id: number
  equipmentId: string
  eventCode: string
  details: { flags?: string[] }
  receivedAt: string
}

type Customer = CustomerRecord
type ServiceRequest = ApiServiceRequest

type SupportMessage = { id: string | number; sender: 'user' | 'assistant' | 'operator'; text: string; time: string }

const roleLabels: Record<UserRole, string> = {
  customer: 'Потребитель',
  operator: 'Диспетчер',
  engineer: 'Инженер',
  administrator: 'Администратор',
}

const formatTenge = (amount: number) => `${Math.round(amount).toLocaleString('ru-RU')} ₸`

const initialSupportMessages: SupportMessage[] = [
  { id: 1, sender: 'assistant', text: 'Здравствуйте. Могу подсказать по начислениям, показаниям счётчика и статусу заявки.', time: '10:00' },
]

const toSupportMessage = (message: ApiSupportMessage): SupportMessage => ({
  id: message.id,
  sender: message.senderType === 'customer' ? 'user' : message.senderType,
  text: message.body,
  time: new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
})

const appendSupportMessage = (messages: SupportMessage[], message: SupportMessage) =>
  messages.some((item) => item.id === message.id) ? messages : [...messages, message]

const navItems = [
  { label: 'Дашборд руководителя', icon: LayoutDashboard },
  { label: 'Схема сети', icon: Map },
  { label: 'Подстанции', icon: Cable },
  { label: 'Клиенты', icon: Users },
  { label: 'Заявки', icon: ClipboardList },
  { label: 'Телеметрия', icon: Activity },
  { label: 'Ремонтные бригады', icon: Wrench },
  { label: 'Аварии', icon: AlertTriangle },
  { label: 'Отчёты', icon: Download },
  { label: 'Корпоративный портал', icon: MessageCircle },
]

const systemNavItems = [
  { label: 'Пользователи', icon: Users },
  { label: 'Настройки', icon: Settings },
]

function QualityEventsPanel({ events, available }: { events: QualityEventSummary[]; available: boolean | null }) {
  const labels: Record<string, string> = {
    stale: 'Измерение устарело',
    future: 'Временная метка из будущего',
    duplicate: 'Повторное измерение',
    out_of_range: 'Подозрительные значения',
  }

  return (
    <article className="panel route-panel quality-events-panel">
      <div className="panel-heading"><div><div className="panel-kicker">КАЧЕСТВО ДАННЫХ · НЕ АВАРИИ</div><h2>Проверки телеметрии</h2></div></div>
      <div className="quality-event-list">
        {available === null && <span>Загрузка журнала качества</span>}
        {available === false && <span>Журнал доступен инженерам и администраторам</span>}
        {available && events.length === 0 && <span>Отклонений не зарегистрировано</span>}
        {available && events.map((event) => <div key={event.id} className="quality-event-row"><strong>{labels[event.eventCode] ?? event.eventCode}</strong><span>{event.equipmentId} · {event.details.flags?.join(', ') ?? 'проверка timestamp'}</span><time>{new Date(event.receivedAt).toLocaleString('ru-RU')}</time></div>)}
      </div>
    </article>
  )
}

function TrendChart({ range }: { range: string }) {
  const chartElement = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chartElement.current) return
    const chart = init(chartElement.current)
    let active = true
    const duration = range === '7 дней' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
    const from = new Date(Date.now() - duration).toISOString()

    void api.getTelemetryHistory(`?page=1&pageSize=100&from=${encodeURIComponent(from)}`)
      .then(({ data }) => {
        if (!active) return
        const equipmentId = data[0]?.equipmentId
        const samples = data.filter((sample) => sample.equipmentId === equipmentId).sort((first, second) =>
          Date.parse(first.measuredAt) - Date.parse(second.measuredAt),
        )
        if (samples.length === 0) {
          chart.setOption({ title: { text: 'За выбранный период измерений нет', left: 'center', top: 'middle', textStyle: { color: '#65736a', fontSize: 12, fontWeight: 'normal' } } })
          return
        }

        chart.setOption({
          animationDuration: 450,
          title: { show: false },
          grid: { left: 48, right: 48, top: 24, bottom: 28 },
          legend: {
            top: 0,
            right: 8,
            itemWidth: 8,
            itemHeight: 8,
            textStyle: { color: '#65736a', fontSize: 11 },
            data: [`Мощность, МВт · ${equipmentId}`, `Напряжение, кВ · ${equipmentId}`],
          },
          tooltip: {
            trigger: 'axis',
            backgroundColor: '#ffffff',
            borderColor: '#dce5df',
            textStyle: { color: '#243129', fontSize: 12 },
          },
          xAxis: {
            type: 'category',
            boundaryGap: false,
            data: samples.map((sample) => new Date(sample.measuredAt).toLocaleString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })),
            axisLine: { lineStyle: { color: '#d2ddd5' } },
            axisTick: { show: false },
            axisLabel: { color: '#65736a', fontSize: 10, hideOverlap: true },
          },
          yAxis: [
            {
              type: 'value',
              name: 'МВт',
              nameTextStyle: { color: '#65736a', fontSize: 10 },
              splitLine: { lineStyle: { color: '#e3eae5', type: 'dashed' } },
              axisLabel: { color: '#65736a', fontSize: 10 },
            },
            {
              type: 'value',
              name: 'кВ',
              nameTextStyle: { color: '#65736a', fontSize: 10 },
              splitLine: { show: false },
              axisLabel: { color: '#65736a', fontSize: 10 },
            },
          ],
          series: [
            {
              name: `Мощность, МВт · ${equipmentId}`,
              type: 'line',
              smooth: 0.35,
              symbol: 'none',
              data: samples.map((sample) => sample.activePower),
              lineStyle: { color: '#527d30', width: 2 },
              areaStyle: { color: 'rgba(82,125,48,.11)' },
            },
            {
              name: `Напряжение, кВ · ${equipmentId}`,
              type: 'line',
              yAxisIndex: 1,
              smooth: 0.35,
              symbol: 'none',
              data: samples.map((sample) => sample.voltage),
              lineStyle: { color: '#167c69', width: 1.5 },
            },
          ],
        })
      })
      .catch(() => {
        if (active) chart.setOption({ title: { text: 'Не удалось загрузить телеметрию из базы', left: 'center', top: 'middle', textStyle: { color: '#a66300', fontSize: 12, fontWeight: 'normal' } } })
      })

    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(chartElement.current)
    return () => {
      active = false
      observer.disconnect()
      chart.dispose()
    }
  }, [range])

  return <div className="trend-chart" ref={chartElement} aria-label="График мощности и напряжения по телеметрии" />
}

type MapFilter = 'all' | 'substation' | 'line' | 'transformer'
type StatusFilter = 'all' | 'normal' | 'warning' | 'critical'
type TelemetryFreshness = 'checking' | 'offline' | 'fresh' | 'stale' | 'suspect'

function telemetryStatusLabel(status: TelemetryFreshness, hasMeasurement: boolean) {
  if (status === 'checking') return 'Проверка источника'
  if (status === 'offline') return 'Источник недоступен'
  if (status === 'suspect') return 'Проверить качество измерения · не авария'
  if (status === 'fresh') return 'Данные актуальны'
  return hasMeasurement ? 'Данные устарели' : 'Нет измерений'
}

function sourceConnectionLabel(status: string) {
  if (status === 'online') return 'Доступен'
  if (status === 'offline' || status === 'unavailable') return 'Нет связи'
  return 'Ожидание данных'
}

const initialNetworkLines: { id: string; label: string; path: string; from: string; to: string; status: Station['status'] }[] = [
  { id: 'line-07', label: 'Л-07', path: 'M98 142H270L350 88', from: 'north', to: 'central', status: 'normal' },
  { id: 'line-12', label: 'Л-12', path: 'M350 88H520L620 142', from: 'central', to: 'east', status: 'normal' },
  { id: 'line-03', label: 'Л-03', path: 'M270 142L350 216H520', from: 'central', to: 'south', status: 'normal' },
  { id: 'line-14', label: 'Л-14', path: 'M520 216L620 142', from: 'east', to: 'west', status: 'warning' },
  { id: 'line-20', label: 'Л-20', path: 'M350 88V216', from: 'central', to: 'south', status: 'normal' },
]
const stationMapPositions: Record<string, { x: number; y: number; labelY: number; voltageY: number }> = {
  north: { x: 98, y: 142, labelY: 174, voltageY: 190 },
  central: { x: 350, y: 88, labelY: 50, voltageY: 35 },
  east: { x: 620, y: 142, labelY: 174, voltageY: 190 },
  south: { x: 350, y: 216, labelY: 253, voltageY: 270 },
  west: { x: 520, y: 216, labelY: 253, voltageY: 270 },
}
type NetworkTransformer = {
  id: string
  name: string
  kind: 'transformer'
  status: Station['status']
  stationId: string
}

const initialTransformer: NetworkTransformer = {
  id: 'transformer-west-2',
  name: 'Трансформатор Т-2',
  kind: 'transformer',
  status: 'warning',
  stationId: 'west',
}

const toAssetStatus = (status: string): Station['status'] => {
  if (status === 'normal' || status === 'warning' || status === 'critical') return status
  throw new Error(`Неизвестный статус оборудования: ${status}`)
}

function NetworkMap({
  selected,
  onSelect,
  typeFilter,
  statusFilter,
  detailMode,
  stationId,
  stations,
  networkLines,
  networkTransformer,
}: {
  selected: string
  onSelect: (id: string) => void
  typeFilter: MapFilter
  statusFilter: StatusFilter
  detailMode: boolean
  stationId: string
  stations: Station[]
  networkLines: typeof initialNetworkLines
  networkTransformer: NetworkTransformer | null
}) {
  const isVisible = (kind: MapFilter, status: StatusFilter) =>
    (typeFilter === 'all' || typeFilter === kind)
    && (statusFilter === 'all' || statusFilter === status)
  const focusedStation = stations.find((station) => station.id === stationId)
  const connectedLines = networkLines.filter((line) => (line.from === stationId || line.to === stationId)
    && isVisible('line', line.status as StatusFilter))

  return (
    <div className="map-canvas">
      <svg className="network-lines" style={{ display: detailMode ? 'none' : undefined }} viewBox="0 0 720 300" role="group" aria-label="Однолинейная схема электросети">
        <defs>
          <pattern id="map-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#34443a" />
          </pattern>
        </defs>
        <rect width="720" height="300" fill="url(#map-grid)" />
        {typeFilter === 'all' || typeFilter === 'line' ? networkLines.filter((line) => isVisible('line', line.status as StatusFilter)).map((line) => (
          <g key={line.id} className={`map-line ${selected === line.id ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`${line.label}, ${line.id}`} onClick={() => onSelect(line.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(line.id) }}>
            <path d={line.path} className="line-hit-area" />
            <path d={line.path} className={`line-visible ${line.status}`} />
            <text className="map-line-label" x={line.id === 'line-07' ? 173 : line.id === 'line-12' ? 434 : line.id === 'line-14' ? 565 : line.id === 'line-20' ? 365 : 440} y={line.id === 'line-12' ? 74 : line.id === 'line-14' ? 180 : line.id === 'line-20' ? 155 : line.id === 'line-03' ? 238 : 128}>{line.label}</text>
          </g>
        )) : null}
        {stations.map((station) => {
          const position = stationMapPositions[station.id]
          if (!position || !isVisible('substation', station.status)) return null
          const nodeClass = selected === station.id
            ? 'node-active'
            : station.status === 'warning' ? 'node-warn' : station.status === 'critical' ? 'node-critical' : ''
          const label = station.name.replace(/^ПС\s*/, '')
          return <g key={station.id} className="map-node" onClick={() => onSelect(station.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(station.id) }} role="button" tabIndex={0} aria-label={`${station.name}, ${station.id}`}>
            <circle cx={position.x} cy={position.y} r={station.status === 'normal' ? 11 : 13} className={nodeClass} />
            <text x={position.x} y={position.labelY}>{label}</text>
            <text x={position.x} y={position.voltageY} className="node-voltage">{station.voltage} · {station.id}</text>
          </g>
        })}
        {networkTransformer && isVisible('transformer', networkTransformer.status) && <g className="map-node map-transformer" onClick={() => onSelect(networkTransformer.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelect(networkTransformer.id) }} role="button" tabIndex={0} aria-label={`${networkTransformer.name}, ${networkTransformer.id}`}>
          <rect x="540" y="192" width="19" height="19" rx="3" className={selected === networkTransformer.id ? 'node-active' : networkTransformer.status === 'critical' ? 'node-critical' : networkTransformer.status === 'warning' ? 'node-warn' : ''} />
          <text x="550" y="228">{networkTransformer.name} · {networkTransformer.id}</text>
        </g>}
        <g className="line-labels">
        </g>
      </svg>
      {detailMode && focusedStation && <div className="detail-network-view">
        <div className="detail-network-heading"><span className={`asset-dot ${focusedStation.status}`} /><div><strong>{focusedStation.name}</strong><small>ID: {focusedStation.id} · {focusedStation.voltage}</small></div></div>
        <div className="detail-bus" />
        <div className="detail-equipment-list">
          {connectedLines.map((line) => <button key={line.id} className={`detail-equipment ${selected === line.id ? 'selected' : ''}`} onClick={() => onSelect(line.id)}><Cable size={15} /><span><strong>{line.label}</strong><small>ID: {line.id} · линия</small></span><i className={`asset-dot ${line.status}`} /></button>)}
          {networkTransformer && focusedStation.id === networkTransformer.stationId && isVisible('transformer', networkTransformer.status) && <button className={`detail-equipment ${selected === networkTransformer.id ? 'selected' : ''}`} onClick={() => onSelect(networkTransformer.id)}><Zap size={15} /><span><strong>{networkTransformer.name}</strong><small>ID: {networkTransformer.id} · трансформатор</small></span><i className={`asset-dot ${networkTransformer.status}`} /></button>}
          {connectedLines.length === 0 && !(networkTransformer && focusedStation.id === networkTransformer.stationId && isVisible('transformer', networkTransformer.status)) && <span className="detail-empty">По текущим фильтрам оборудование не найдено</span>}
        </div>
      </div>}
      <div className="map-legend">
        <span><i className="legend-dot online" />В норме</span>
        <span><i className="legend-dot warning" />Внимание</span>
        <span><i className="legend-dot critical" />Авария</span>
      </div>
      <div className="map-scale">Топология из БД · размещение элементов фиксировано</div>
    </div>
  )
}

function DashboardContent({ currentUser, onLogout }: { currentUser: LocalUser; onLogout: () => void }) {
  const [stationRecords, setStationRecords] = useState<Station[]>([])
  const [equipmentLines, setEquipmentLines] = useState<typeof initialNetworkLines>([])
  const [transformerRecord, setTransformerRecord] = useState<NetworkTransformer | null>(null)
  const [repairCrews, setRepairCrews] = useState<RepairCrewRecord[]>([])
  const [selectedStation, setSelectedStation] = useState('central')
  const [selectedElementId, setSelectedElementId] = useState('central')
  const [mapTypeFilter, setMapTypeFilter] = useState<MapFilter>('all')
  const [mapStatusFilter, setMapStatusFilter] = useState<StatusFilter>('all')
  const [detailMode, setDetailMode] = useState(false)
  const [activeNav, setActiveNav] = useState(currentUser.role === 'customer' ? 'Корпоративный портал' : 'Дашборд руководителя')
  const [range, setRange] = useState('24 часа')
  const [search, setSearch] = useState('')
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([])
  const [tariffPerKwh, setTariffPerKwh] = useState(0)
  const [customerSearch, setCustomerSearch] = useState('')
  const [serviceFormKind, setServiceFormKind] = useState<'new_connection' | 'disconnection_review' | 'remote_switch_review'>('new_connection')
  const [serviceFormCustomerId, setServiceFormCustomerId] = useState('')
  const [portalCustomerId, setPortalCustomerId] = useState('')
  const [serviceFormOpen, setServiceFormOpen] = useState(false)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)
  const [customerNameDraft, setCustomerNameDraft] = useState('')
  const [customerAddressDraft, setCustomerAddressDraft] = useState('')
  const [customerBuildingDraft, setCustomerBuildingDraft] = useState('')
  const [repairRequestOpen, setRepairRequestOpen] = useState(false)
  const [repairRequestCustomerId, setRepairRequestCustomerId] = useState('')
  const [repairRequestDescription, setRepairRequestDescription] = useState('')
  const [repairRequestPriority, setRepairRequestPriority] = useState<'normal' | 'urgent'>('normal')
  const [supportMode, setSupportMode] = useState<'assistant' | 'operator'>(() =>
    ['operator', 'engineer', 'administrator'].includes(currentUser.role) ? 'operator' : 'assistant',
  )
  const [supportMessages, setSupportMessages] = useState(initialSupportMessages)
  const [operatorChatMessages, setOperatorChatMessages] = useState<SupportMessage[]>([])
  const [supportDraft, setSupportDraft] = useState('')
  const [supportStatus, setSupportStatus] = useState<'idle' | 'connecting' | 'connected' | 'unavailable'>('idle')
  const [operatorsOnline, setOperatorsOnline] = useState<number | null>(null)
  const [supportSending, setSupportSending] = useState(false)
  const [isSupportAgent, setIsSupportAgent] = useState(false)
  const [supportConversations, setSupportConversations] = useState<SupportConversation[]>([])
  const [selectedOperatorConversation, setSelectedOperatorConversation] = useState<string | null>(null)
  const [operatorMessages, setOperatorMessages] = useState<SupportMessage[]>([])
  const [operatorDraft, setOperatorDraft] = useState('')
  const [operatorSending, setOperatorSending] = useState(false)
  const [users, setUsers] = useState<LocalUser[]>([])
  const [accountCustomerId, setAccountCustomerId] = useState('')
  const [accountUsername, setAccountUsername] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [creatingCustomerAccount, setCreatingCustomerAccount] = useState(false)
  const [supplyReviewCustomerId, setSupplyReviewCustomerId] = useState<string | null>(null)
  const supportConversationIdRef = useRef<string | null>(null)
  const assistantConversationIdRef = useRef<string | null>(null)
  const selectedOperatorConversationRef = useRef<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null)
  const [databaseAvailable, setDatabaseAvailable] = useState<boolean | null>(null)
  const [telemetrySourceStatus, setTelemetrySourceStatus] = useState('unknown')
  const [telemetryEndpointAvailable, setTelemetryEndpointAvailable] = useState(false)
  const [latestMeasurement, setLatestMeasurement] = useState<TelemetrySample | null>(null)
  const [qualityEvents, setQualityEvents] = useState<QualityEventSummary[]>([])
  const [qualityEventsAvailable, setQualityEventsAvailable] = useState<boolean | null>(null)
  const [clock, setClock] = useState(Date.now())
  const [refreshRequest, setRefreshRequest] = useState(0)

  useEffect(() => {
    let active = true
    void Promise.all([
      api.getCustomers(),
      api.getServiceRequests(),
      currentUser.role === 'customer' ? Promise.resolve(null) : api.getAlarms('?page=1&pageSize=100'),
      currentUser.role === 'customer' ? Promise.resolve(null) : api.getSubstations('?page=1&pageSize=100'),
      currentUser.role === 'customer' ? Promise.resolve(null) : api.getEquipment('?page=1&pageSize=100'),
      currentUser.role === 'customer' ? Promise.resolve(null) : api.getRepairCrews(),
    ])
      .then(([customerData, requestData, alarmData, substationData, equipmentData, crewData]) => {
        if (!active) return
        setCustomers(customerData.customers)
        setTariffPerKwh(customerData.tariffPerKwh)
        setServiceRequests(requestData)
        if (substationData) {
          setStationRecords(substationData.data.map((station) => ({
            id: station.id,
            name: station.name,
            location: station.district,
            voltage: `${station.voltageKv} кВ`,
            load: station.loadPercent,
            status: station.status,
          })))
        }
        if (equipmentData) {
          const equipmentById = new globalThis.Map(equipmentData.data.map((item) => [item.id, item] as const))
          setEquipmentLines(initialNetworkLines.map((line) => {
            const equipment = equipmentById.get(line.id)
            return equipment ? { ...line, status: toAssetStatus(equipment.status) } : line
          }))
          const transformer = equipmentById.get(initialTransformer.id)
          if (transformer) {
            setTransformerRecord({
              ...initialTransformer,
              name: transformer.name,
              status: toAssetStatus(transformer.status),
            })
          }
        }
        if (crewData) setRepairCrews(crewData)
        if (alarmData) {
          setIncidents(alarmData.data.map((alarm: AlarmRecord) => ({
            id: alarm.id,
            title: alarm.title,
            detail: alarm.equipmentId,
            equipmentId: alarm.equipmentId,
            time: new Date(alarm.occurredAt).toLocaleTimeString('ru-RU'),
            severity: alarm.severity,
            acknowledged: alarm.acknowledged,
          })))
        }
        const firstCustomerId = customerData.customers[0]?.id ?? ''
        setPortalCustomerId((current) => customerData.customers.some((item) => item.id === current) ? current : firstCustomerId)
        setServiceFormCustomerId((current) => customerData.customers.some((item) => item.id === current) ? current : firstCustomerId)
        setRepairRequestCustomerId((current) => customerData.customers.some((item) => item.id === current) ? current : firstCustomerId)
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Не удалось загрузить данные из базы: ${error instanceof Error ? error.message : 'ошибка API'}`)
      })
    return () => { active = false }
  }, [currentUser.subject, currentUser.role, refreshRequest])

  useEffect(() => {
    const availableCustomers = customers.filter((customer) => !customer.hasAccount)
    if (availableCustomers.some((customer) => customer.id === accountCustomerId)) return
    const nextCustomer = availableCustomers[0]
    setAccountCustomerId(nextCustomer?.id ?? '')
    setAccountUsername(nextCustomer?.id.toLowerCase() ?? '')
  }, [customers, accountCustomerId])

  const availableNavItems = currentUser.role === 'customer'
    ? navItems.filter((item) => item.label === 'Корпоративный портал')
    : currentUser.role === 'engineer'
      ? navItems.filter((item) => !['Клиенты', 'Заявки'].includes(item.label))
      : navItems
  const availableSystemNavItems = currentUser.role === 'administrator' ? systemNavItems : []
  const visibleCustomers = customers.filter((customer) => `${customer.id} ${customer.name} ${customer.address}`.toLowerCase().includes(customerSearch.toLowerCase()))
  const portalCustomer = customers.find((customer) => customer.id === portalCustomerId) ?? customers[0]
  const monthlyConsumption = customers.reduce((total, customer) => total + customer.monthlyKwh, 0)
  const monthlyCharges = monthlyConsumption * tariffPerKwh
  const overdueCustomers = customers.filter((customer) => customer.unpaidBalance > 0)
  const displayInitials = currentUser.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('ru-RU')
  const buildingConsumption = Object.values(customers.reduce<Record<string, { name: string; kwh: number }>>((result, customer) => {
    result[customer.building] ??= { name: customer.building, kwh: 0 }
    result[customer.building].kwh += customer.monthlyKwh
    return result
  }, {})).sort((first, second) => second.kwh - first.kwh)

  const openServiceRequest = async (
    kind: ServiceRequest['kind'],
    customerId: string,
    summary: string,
    status: ServiceRequest['status'] = 'pending_review',
  ) => {
    if (!customerId) {
      setNotice('Сначала загрузите или создайте лицевой счёт')
      return
    }
    try {
      const request = await api.createServiceRequest({ customerId, kind, summary, status })
      setServiceRequests((items) => [request, ...items])
      setNotice('Заявка сохранена в базе и ожидает ручной проверки')
    } catch (error) {
      setNotice(`Не удалось сохранить заявку: ${error instanceof Error ? error.message : 'ошибка API'}`)
    }
  }

  const createSupplyReview = async (customer: Customer, action: 'disconnect' | 'reconnect') => {
    setSupplyReviewCustomerId(customer.id)
    try {
      const request = await api.createCustomerSupplyReview(customer.id, action)
      setServiceRequests((items) => [request, ...items])
      setNotice(action === 'disconnect'
        ? 'Запрос на проверку отключения сохранён в БД. Электроснабжение не отключалось.'
        : 'Запрос на проверку восстановления сохранён в БД. Оборудование не переключалось.')
    } catch (error) {
      setNotice(`Не удалось сохранить запрос: ${error instanceof Error ? error.message : 'ошибка API'}`)
    } finally {
      setSupplyReviewCustomerId(null)
    }
  }

  const setCustomerSupplyStatus = async (customer: Customer, supplyStatus: Customer['supplyStatus']) => {
    const label = supplyStatus === 'connected'
      ? 'включённым в реестре'
      : supplyStatus === 'disconnected'
        ? 'отключённым в реестре'
        : 'неподтверждённым в реестре'
    if (!window.confirm(`Подтверждаете по фактической проверке, что питание клиента ${customer.name} отмечено как ${label}? Это изменит только запись в БД и не управляет электроснабжением.`)) return
    setSupplyReviewCustomerId(customer.id)
    try {
      const updated = await api.updateCustomerSupplyStatus(customer.id, supplyStatus)
      setCustomers((items) => items.map((item) => item.id === customer.id ? updated : item))
      setNotice(`Статус питания клиента обновлён в БД: ${supplyStatus === 'connected' ? 'включено' : supplyStatus === 'disconnected' ? 'отключено' : 'не подтверждено'} в реестре`)
    } catch (error) {
      setNotice(`Не удалось обновить статус питания: ${error instanceof Error ? error.message : 'ошибка API'}`)
    } finally {
      setSupplyReviewCustomerId(null)
    }
  }

  const updateRequestStatus = async (requestId: string, status: ServiceRequest['status']) => {
    try {
      const updated = await api.updateServiceRequestStatus(requestId, status)
      setServiceRequests((items) => items.map((item) => item.id === requestId ? updated : item))
    } catch (error) {
      setNotice(`Не удалось изменить заявку: ${error instanceof Error ? error.message : 'ошибка API'}`)
    }
  }

  const submitRepairRequest = async () => {
    const description = repairRequestDescription.trim()
    if (description.length < 8) {
      setNotice('Опишите неисправность подробнее')
      return
    }
    const priority = repairRequestPriority === 'urgent' ? 'Срочный приоритет' : 'Плановая заявка'
    await openServiceRequest('repair', repairRequestCustomerId, `${priority}: ${description}`)
    setRepairRequestDescription('')
    setRepairRequestPriority('normal')
    setRepairRequestOpen(false)
  }

  const addCustomer = async () => {
    const name = customerNameDraft.trim()
    const address = customerAddressDraft.trim()
    const building = customerBuildingDraft.trim()
    if (!name || !address || !building) {
      setNotice('Заполните ФИО, адрес и дом')
      return
    }
    try {
      const customer = await api.createCustomer({ name, address, building })
      setCustomers((items) => [...items, customer])
      setServiceFormCustomerId(customer.id)
      setCustomerNameDraft('')
      setCustomerAddressDraft('')
      setCustomerBuildingDraft('')
      setNewCustomerOpen(false)
      setNotice(`Клиент ${customer.id} сохранён в базе; подключение требует заявки`)
    } catch (error) {
      setNotice(`Не удалось сохранить клиента: ${error instanceof Error ? error.message : 'ошибка API'}`)
    }
  }

  const sendSupportMessage = async () => {
    const text = supportDraft.trim()
    if (!text || supportSending) return
    if (supportMode === 'operator') {
      setSupportSending(true)
      try {
        let conversationId = supportConversationIdRef.current
        if (!conversationId) {
          const conversation = await api.createSupportConversation({ customerId: portalCustomerId, title: 'Консультация клиента' })
          conversationId = conversation.id
          supportConversationIdRef.current = conversationId
        }
        const message = await api.sendSupportMessage(conversationId, { body: text, senderType: 'customer' })
        setOperatorChatMessages((items) => appendSupportMessage(items, toSupportMessage(message)))
        setSupportDraft('')
        setSupportStatus('connected')
      } catch (error) {
        setSupportStatus('unavailable')
        setNotice(`Не удалось отправить сообщение оператору: ${error instanceof Error ? error.message : 'ошибка API'}`)
      } finally {
        setSupportSending(false)
      }
      return
    }

    const lowerText = text.toLowerCase()
    const response = lowerText.includes('счет') || lowerText.includes('начис') || lowerText.includes('оплат')
        ? 'Сумма за месяц рассчитывается по показаниям умного счётчика и тарифу. Откройте раздел «Клиенты», чтобы посмотреть начисление по лицевому ID.'
        : lowerText.includes('подключ') || lowerText.includes('отключ')
          ? 'Подключение и отключение оформляются заявкой и требуют ручной проверки сотрудником. Автоматического переключения сети нет.'
          : 'Я могу помочь с начислениями, показаниями счётчика и статусом заявки. Для индивидуального вопроса переключитесь на оператора.'
    setSupportSending(true)
    try {
      let conversationId = assistantConversationIdRef.current
      if (!conversationId) {
        const conversation = await api.createSupportConversation({ customerId: portalCustomerId, title: 'Консультация с ИИ-ассистентом' })
        conversationId = conversation.id
        assistantConversationIdRef.current = conversationId
      }
      const customerMessage = await api.sendSupportMessage(conversationId, { body: text, senderType: 'customer' })
      setSupportMessages((items) => appendSupportMessage(items, toSupportMessage(customerMessage)))
      setSupportDraft('')
      const assistantMessage = await api.sendSupportMessage(conversationId, { body: response, senderType: 'assistant' })
      setSupportMessages((items) => appendSupportMessage(items, toSupportMessage(assistantMessage)))
    } catch (error) {
      setNotice(`Не удалось сохранить сообщение: ${error instanceof Error ? error.message : 'ошибка API'}`)
    } finally {
      setSupportSending(false)
    }
  }

  const sendOperatorReply = async () => {
    const conversationId = selectedOperatorConversationRef.current
    const text = operatorDraft.trim()
    if (!conversationId || !text || operatorSending) return
    setOperatorSending(true)
    try {
      const message = await api.sendSupportMessage(conversationId, { body: text, senderType: 'operator' })
      const viewMessage = toSupportMessage(message)
      setOperatorMessages((items) => appendSupportMessage(items, viewMessage))
      if (conversationId === supportConversationIdRef.current) {
        setOperatorChatMessages((items) => appendSupportMessage(items, viewMessage))
      }
      setOperatorDraft('')
    } catch (error) {
      setNotice(`Не удалось отправить ответ: ${error instanceof Error ? error.message : 'ошибка API'}`)
    } finally {
      setOperatorSending(false)
    }
  }

  const assignOperatorConversation = async (conversationId: string) => {
    try {
      const updated = await api.assignSupportConversation(conversationId)
      setSupportConversations((items) => items.map((item) => item.id === updated.id ? updated : item))
    } catch (error) {
      setNotice(`Не удалось назначить обращение: ${error instanceof Error ? error.message : 'ошибка API'}`)
    }
  }

  const selectOperatorConversation = (conversationId: string) => {
    if (selectedOperatorConversationRef.current !== conversationId) setOperatorMessages([])
    selectedOperatorConversationRef.current = conversationId
    setSelectedOperatorConversation(conversationId)
  }

  const selectedLine = equipmentLines.find((line) => line.id === selectedElementId)
  const selectedStationRecord = stationRecords.find((station) => station.id === selectedElementId)
  const selectedElement = selectedStationRecord
    ? { id: selectedStationRecord.id, name: selectedStationRecord.name, kind: 'substation', status: selectedStationRecord.status }
    : selectedLine
      ? { id: selectedLine.id, name: `Линия ${selectedLine.label}`, kind: 'line', status: selectedLine.status }
      : transformerRecord ?? { id: selectedElementId, name: selectedElementId, kind: 'equipment', status: 'unknown' }
  const associatedElementIds = selectedStationRecord
    ? [
      selectedStationRecord.id,
      ...equipmentLines.filter((line) => line.from === selectedStationRecord.id || line.to === selectedStationRecord.id).map((line) => line.id),
      ...(transformerRecord && selectedStationRecord.id === transformerRecord.stationId ? [transformerRecord.id] : []),
    ]
    : [selectedElement.id]
  const relatedIncidents = incidents.filter((incident) => associatedElementIds.includes(incident.equipmentId))
  const selectedMeasurement = latestMeasurement && associatedElementIds.includes(latestMeasurement.equipmentId)
    ? latestMeasurement
    : null
  const visibleStations = stationRecords.filter((station) => station.name.toLowerCase().includes(search.toLowerCase()))
  const activeIncidents = incidents.filter((incident) => !incident.acknowledged).length
  const measurementTimestamp = latestMeasurement ? Date.parse(latestMeasurement.measuredAt) : Number.NaN
  const measurementAge = Number.isFinite(measurementTimestamp)
    ? Math.max(0, Math.floor((clock - measurementTimestamp) / 1000))
    : null
  const telemetryFreshness: TelemetryFreshness = backendAvailable === null
    ? 'checking'
    : !backendAvailable || !telemetryEndpointAvailable || telemetrySourceStatus === 'offline' || telemetrySourceStatus === 'unavailable'
      ? 'offline'
      : measurementAge === null || measurementAge > 60
        ? 'stale'
        : latestMeasurement?.qualityStatus === 'suspect'
          ? 'suspect'
          : measurementAge !== null && measurementAge <= 60
        ? 'fresh'
        : 'stale'
  const lastMeasurementLabel = measurementAge !== null
    ? new Date(measurementTimestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Нет измерений'

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (supportMode === 'assistant') {
      setSupportStatus('idle')
      if (!portalCustomerId) return
      let active = true
      setSupportStatus('connecting')
      void (async () => {
        const conversation = await api.createSupportConversation({ customerId: portalCustomerId, title: 'Консультация с ИИ-ассистентом' })
        if (!active) return
        assistantConversationIdRef.current = conversation.id
        const messages = await api.getSupportMessages(conversation.id)
        if (!active) return
        setSupportMessages([...initialSupportMessages, ...messages.map(toSupportMessage)])
        setSupportStatus('connected')
      })().catch((error: unknown) => {
        if (!active) return
        setSupportStatus('unavailable')
        setNotice(`Не удалось загрузить историю консультации: ${error instanceof Error ? error.message : 'ошибка API'}`)
      })
      return () => { active = false }
    }

    if (supportMode !== 'operator') {
      setSupportStatus('idle')
      return
    }

    let active = true
    setSupportStatus('connecting')
    setOperatorChatMessages([])
    supportConversationIdRef.current = null

    void (async () => {
      try {
        const inbox = await api.getSupportConversations('?page=1&pageSize=100')
        if (!active) return
        setIsSupportAgent(true)
        setSupportConversations(inbox.data)
        if (inbox.data.length > 0) {
          const selected = selectedOperatorConversationRef.current
          const nextSelected = selected && inbox.data.some((item) => item.id === selected)
            ? selected
            : inbox.data[0].id
          selectedOperatorConversationRef.current = nextSelected
          setSelectedOperatorConversation(nextSelected)
        } else {
          selectedOperatorConversationRef.current = null
          setSelectedOperatorConversation(null)
          setOperatorMessages([])
        }
        setSupportStatus('connected')
        return
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 403) throw error
      }

      setIsSupportAgent(false)
      const conversation = await api.createSupportConversation({ customerId: portalCustomerId, title: 'Консультация клиента' })
      if (!active) return
      supportConversationIdRef.current = conversation.id
      const messages = await api.getSupportMessages(conversation.id)
      if (!active) return
      setOperatorChatMessages(messages.map(toSupportMessage))
      setSupportStatus('connected')
    })().catch((error: unknown) => {
      if (!active) return
      setSupportStatus('unavailable')
      setNotice(`Не удалось подключиться к онлайн-поддержке: ${error instanceof Error ? error.message : 'ошибка API'}`)
    })

    return () => { active = false }
  }, [supportMode, portalCustomerId])

  useEffect(() => {
    if (supportMode !== 'operator') return
    const supportSocketOrigin = new URL(import.meta.env.VITE_API_URL ?? window.location.origin, window.location.origin).origin
    const socket = io(`${supportSocketOrigin}/support`, {
      auth: { token: authToken.get() ?? undefined },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })
    socket.on('support.message', (message: ApiSupportMessage) => {
      const viewMessage = toSupportMessage(message)
      if (message.conversationId === supportConversationIdRef.current) {
        setOperatorChatMessages((items) => appendSupportMessage(items, viewMessage))
      }
      if (message.conversationId === selectedOperatorConversationRef.current) {
        setOperatorMessages((items) => appendSupportMessage(items, viewMessage))
      }
      setSupportConversations((items) => items.map((item) =>
        item.id === message.conversationId ? { ...item, updatedAt: message.createdAt } : item,
      ).sort((first, second) => second.updatedAt.localeCompare(first.updatedAt)))
    })
    socket.on('support.conversation', (conversation: SupportConversation) => {
      setSupportConversations((items) => {
        const exists = items.some((item) => item.id === conversation.id)
        return exists
          ? items.map((item) => item.id === conversation.id ? conversation : item)
          : [conversation, ...items]
      })
    })
    socket.on('support.presence', (presence: { operatorsOnline: number }) => {
      setOperatorsOnline(presence.operatorsOnline)
    })
    return () => { socket.disconnect() }
  }, [supportMode])

  useEffect(() => {
    if (!isSupportAgent || !selectedOperatorConversation) {
      setOperatorMessages([])
      return
    }
    let active = true
    void api.getSupportMessages(selectedOperatorConversation)
      .then((messages) => {
        if (active) setOperatorMessages((items) => messages
          .map(toSupportMessage)
          .reduce(appendSupportMessage, items))
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Не удалось открыть обращение: ${error instanceof Error ? error.message : 'ошибка API'}`)
      })
    return () => { active = false }
  }, [isSupportAgent, selectedOperatorConversation])

  useEffect(() => {
    if (activeNav !== 'Пользователи' || currentUser.role !== 'administrator') return
    let active = true
    void api.getUsers('?page=1&pageSize=100')
      .then((result) => {
        if (active) setUsers(result.data)
      })
      .catch((error: unknown) => {
        if (active) setNotice(`Не удалось загрузить пользователей: ${error instanceof Error ? error.message : 'ошибка API'}`)
      })
    return () => { active = false }
  }, [activeNav, currentUser.role])

  const changeUserRole = async (user: LocalUser, role: UserRole) => {
    try {
      const updatedUser = await api.updateUserRole(user.subject, role)
      setUsers((items) => items.map((item) => item.subject === updatedUser.subject ? updatedUser : item))
      if (updatedUser.subject === currentUser.subject && updatedUser.role !== currentUser.role) {
        window.location.reload()
        return
      }
      setNotice(`Для ${updatedUser.username} назначена роль «${roleLabels[updatedUser.role]}»`)
    } catch (error) {
      setNotice(`Не удалось изменить роль: ${error instanceof Error ? error.message : 'ошибка API'}`)
    }
  }

  const createCustomerAccount = async () => {
    const username = accountUsername.trim()
    if (!accountCustomerId || !username || accountPassword.length < 10) {
      setNotice('Выберите лицевой счёт, укажите логин и пароль длиной не менее 10 символов')
      return
    }

    setCreatingCustomerAccount(true)
    try {
      const user = await api.createCustomerAccount({
        customerId: accountCustomerId,
        username,
        password: accountPassword,
      })
      setUsers((items) => [...items, user])
      setCustomers((items) => items.map((customer) =>
        customer.id === accountCustomerId ? { ...customer, hasAccount: true } : customer,
      ))
      setAccountPassword('')
      setNotice(`Учётная запись ${user.username} создана и привязана к лицевому счёту ${accountCustomerId}`)
    } catch (error) {
      setNotice(`Не удалось создать учётную запись: ${error instanceof Error ? error.message : 'ошибка API'}`)
    } finally {
      setCreatingCustomerAccount(false)
    }
  }

  useEffect(() => {
    let active = true
    const checkSources = async () => {
      const [healthResult, measurementsResult] = await Promise.allSettled([
        api.getHealth(),
        api.getLatestTelemetry(),
      ])
      if (!active) return

      setBackendAvailable(healthResult.status === 'fulfilled' && healthResult.value.status === 'ok')
      setDatabaseAvailable(healthResult.status === 'fulfilled'
        ? healthResult.value.dependencies?.database === 'available'
        : false)
      setTelemetrySourceStatus(healthResult.status === 'fulfilled'
        ? healthResult.value.dependencies?.telemetrySource?.status ?? 'unknown'
        : 'unavailable')
      setTelemetryEndpointAvailable(measurementsResult.status === 'fulfilled')
      if (measurementsResult.status === 'fulfilled' && measurementsResult.value.data[0]) {
        setLatestMeasurement(measurementsResult.value.data[0])
      }
    }

    void checkSources()
    const socket = io('/telemetry', {
      auth: { token: sessionStorage.getItem('powergrid.accessToken') ?? undefined },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })
    socket.on('connect', () => void checkSources())
    socket.on('telemetry.measurement', (sample: TelemetrySample) => {
      setLatestMeasurement(sample)
      setBackendAvailable(true)
      setTelemetryEndpointAvailable(true)
      setTelemetrySourceStatus('online')
      setClock(Date.now())
    })
    const sourceTimer = window.setInterval(() => void checkSources(), 10000)
    const clockTimer = window.setInterval(() => setClock(Date.now()), 5000)
    return () => {
      active = false
      socket.disconnect()
      window.clearInterval(sourceTimer)
      window.clearInterval(clockTimer)
    }
  }, [refreshRequest])

  useEffect(() => {
    if (activeNav !== 'Телеметрия') return
    let active = true
    void api.getTelemetryQuality('?page=1&pageSize=5')
      .then((result) => {
        if (!active) return
        setQualityEvents(result.data as QualityEventSummary[])
        setQualityEventsAvailable(true)
      })
      .catch(() => {
        if (!active) return
        setQualityEvents([])
        setQualityEventsAvailable(false)
      })
    return () => { active = false }
  }, [activeNav, refreshRequest])

  const refreshData = () => {
    setRefreshCount((count) => count + 1)
    setRefreshRequest((request) => request + 1)
    setNotice('Проверка источников запущена')
  }

  const selectNetworkElement = (id: string) => {
    setSelectedElementId(id)
    if (stationRecords.some((station) => station.id === id)) setSelectedStation(id)
    if (transformerRecord && id === transformerRecord.id) setSelectedStation(transformerRecord.stationId)
  }

  const acknowledgeIncident = async (id: string) => {
    try {
      const updated = await api.acknowledgeAlarm(id)
      setIncidents((items) => items.map((item) => item.id === id ? { ...item, acknowledged: updated.acknowledged } : item))
    } catch (error) {
      setNotice(`Не удалось подтвердить аварию: ${error instanceof Error ? error.message : 'ошибка API'}`)
    }
  }

  const acknowledgeAllIncidents = async () => {
    await Promise.all(incidents
      .filter((incident) => !incident.acknowledged)
      .map((incident) => acknowledgeIncident(incident.id)))
  }

  const exportReport = () => {
    const rows = [
      ['Подстанция', 'Район', 'Напряжение', 'Нагрузка, %', 'Состояние'],
      ...stationRecords.map((station) => [station.name, station.location, station.voltage, String(station.load), station.status]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\r\n')}`
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = 'powergrid-report.csv'
    link.click()
    URL.revokeObjectURL(link.href)
    setNotice('Отчёт выгружен в CSV')
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Zap size={19} fill="currentColor" /></div>
          <div><strong>powergrid</strong><span>MONITORING SYSTEM</span></div>
          <button className="icon-button sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню"><X size={18} /></button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">Э</div>
          <div className="workspace-copy"><strong>Энергорайон 01</strong><span>Диспетчерская</span></div>
          <ChevronDown size={15} />
        </div>
        <div className="sidebar-label">МОНИТОРИНГ</div>
        <nav className="primary-nav" aria-label="Основная навигация">
          {availableNavItems.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${activeNav === label ? 'active' : ''}`} onClick={() => { setActiveNav(label); setMenuOpen(false) }}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {label === 'Клиенты' && <span className="nav-count">{customers.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-label tools-label">СИСТЕМА</div>
        <nav className="primary-nav" aria-label="Управление системой">
          {availableSystemNavItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activeNav === label ? 'active' : ''}`} onClick={() => { setActiveNav(label); setMenuOpen(false) }}><Icon size={17} /><span>{label}</span></button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <div className={`connection-head source-${telemetryFreshness}`}><span className="source-indicator" />ИСТОЧНИК ТЕЛЕМЕТРИИ</div>
            <p>{telemetryStatusLabel(telemetryFreshness, Boolean(latestMeasurement))}</p>
            <span className="connection-time"><Clock3 size={12} />Последнее измерение: {lastMeasurementLabel}</span>
          </div>
          <button className="profile-row" onClick={onLogout} aria-label={`Выйти из аккаунта ${currentUser.username}`}>
            <div className="profile-avatar">{displayInitials}</div><div className="profile-copy"><strong>{currentUser.displayName}</strong><span>{roleLabels[currentUser.role]} · {currentUser.username}</span></div><LogOut size={15} />
          </button>
        </div>
      </aside>

      {menuOpen && <button className="mobile-scrim" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button menu-trigger" onClick={() => setMenuOpen(true)} aria-label="Открыть меню"><Menu size={19} /></button>
          <div className="breadcrumbs"><span>Мониторинг</span><span className="crumb-separator">/</span><strong>{activeNav}</strong></div>
          <div className="topbar-actions">
            <div className={`system-status source-${backendAvailable === null ? 'checking' : backendAvailable ? 'fresh' : 'offline'}`}><span className="live-dot" />API {backendAvailable === null ? 'проверка' : backendAvailable ? 'доступен' : 'недоступен'}</div>
            <span className="topbar-divider" />
            <button className="icon-button help-button" aria-label="Справка" onClick={() => setNotice('Демонстрационная версия PowerGrid Monitor')}><CircleHelp size={18} /></button>
            <button className="icon-button notification-button" aria-label={`Уведомления: ${activeIncidents}`} onClick={() => document.getElementById('incident-list')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
              <Bell size={18} />{activeIncidents > 0 && <i />}
            </button>
            <div className="topbar-date">{new Date(clock).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        </header>

        <div className="content-wrap">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span className="live-dot" />ОПЕРАТИВНАЯ СВОДКА</div>
              <h1>{activeNav === 'Дашборд руководителя' ? 'Оперативная сводка' : activeNav}</h1>
              <p>Энергорайон 01 <span>·</span> Все узлы электроснабжения</p>
            </div>
            <div className="heading-actions">
              <span className="demo-chip"><Radio size={13} />ДЕМО-ДАННЫЕ</span>
              <button className="button button-secondary" onClick={refreshData}><RefreshCw size={15} className={refreshCount > 0 ? 'refresh-tick' : ''} />Обновить</button>
              <button className="button button-primary" onClick={exportReport}><Download size={15} />Экспорт</button>
            </div>
          </section>

          {activeNav === 'Дашборд руководителя' && <>
          <section className="metrics-grid" aria-label="Ключевые показатели">
            <article className="metric-card metric-primary">
              <div className="metric-top"><span>АКТИВНАЯ МОЩНОСТЬ</span><div className="metric-icon lime-icon"><Zap size={16} /></div></div>
              <div className="metric-value">{latestMeasurement?.activePower.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) ?? '—'} <small>МВт</small></div>
              <div className="metric-foot"><span className="status-ok"><span />Из базы</span><span>{lastMeasurementLabel}</span></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>НАПРЯЖЕНИЕ</span><div className="metric-icon teal-icon"><Activity size={16} /></div></div>
              <div className="metric-value">{latestMeasurement?.voltage.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) ?? '—'} <small>кВ</small></div>
              <div className="metric-foot"><span className="status-ok"><span />Из базы</span><span>{lastMeasurementLabel}</span></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>ЧАСТОТА СЕТИ</span><div className="metric-icon blue-icon"><Gauge size={16} /></div></div>
              <div className="metric-value">{latestMeasurement?.frequency.toLocaleString('ru-RU', { maximumFractionDigits: 3 }) ?? '—'} <small>Гц</small></div>
              <div className="metric-foot"><span className="status-ok"><span />Из базы</span><span>{lastMeasurementLabel}</span></div>
            </article>
            <article className="metric-card metric-alert-card">
              <div className="metric-top"><span>АВАРИЙНЫЕ СОБЫТИЯ</span><div className="metric-icon amber-icon"><AlertTriangle size={16} /></div></div>
              <div className="metric-value">{String(activeIncidents).padStart(2, '0')} <small>активных</small></div>
              <div className="metric-foot"><span className="trend-alert"><span />Требуют внимания</span><span>за текущую смену</span></div>
            </article>
          </section>

          <section className="manager-register-grid" aria-label="Состояние реестров сети">
            <article className="manager-register-card"><Cable size={17} /><span><strong>{stationRecords.length}</strong><small>подстанций в реестре · {stationRecords.filter((station) => station.status !== 'normal').length} требуют внимания</small></span></article>
            <article className="manager-register-card"><Users size={17} /><span><strong>{customers.length}</strong><small>клиентов в реестре · {customers.filter((customer) => customer.supplyStatus === 'disconnected').length} с учётной отметкой «отключён»</small></span></article>
            <article className="manager-register-card"><Radio size={17} /><span><strong>{customers.filter((customer) => customer.meterStatus !== 'online').length}</strong><small>счётчиков не в статусе online</small></span></article>
            <article className="manager-register-card"><ClipboardList size={17} /><span><strong>{serviceRequests.filter((request) => request.status === 'pending_review').length}</strong><small>заявок ожидают рассмотрения</small></span></article>
          </section>

          <section className="manager-utility-grid">
            <article className="panel manager-consumption-panel">
              <div className="panel-heading"><div><div className="panel-kicker">ПОТРЕБИТЕЛИ · ТЕКУЩИЙ МЕСЯЦ</div><h2>Дома с наибольшим расходом</h2></div><span className="demo-chip">кВт·ч</span></div>
              <div className="building-load-list">{buildingConsumption.slice(0, 5).map((building, index) => <div className="building-load-row" key={building.name}><span className="building-rank">{String(index + 1).padStart(2, '0')}</span><span className="building-load-name"><strong>{building.name}</strong><i><b style={{ width: `${Math.min(100, building.kwh / Math.max(1, buildingConsumption[0]?.kwh ?? 1) * 100)}%` }} /></i></span><strong className="building-load-value">{building.kwh.toLocaleString('ru-RU')}</strong><span className={index === 0 ? 'asset-state warning' : 'asset-state normal'}>{index === 0 ? 'Проверить' : 'Норма'}</span></div>)}</div>
            </article>
            <article className="panel manager-billing-panel">
              <div className="panel-heading"><div><div className="panel-kicker">КОММЕРЧЕСКИЙ УЧЁТ · ДЕМО</div><h2>Расчёты за месяц</h2></div><Banknote size={17} className="billing-icon" /></div>
              <div className="billing-total"><strong>{formatTenge(monthlyCharges)}</strong><span>{monthlyConsumption.toLocaleString('ru-RU')} кВт·ч · demo тариф {tariffPerKwh.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₸/кВт·ч</span></div>
              <div className="billing-summary"><span>Клиентов <strong>{customers.length}</strong></span><span>Задолженность <strong className={overdueCustomers.length ? 'source-suspect' : ''}>{formatTenge(overdueCustomers.reduce((total, customer) => total + customer.unpaidBalance, 0))}</strong></span><span>Заявки на проверке <strong>{serviceRequests.filter((request) => request.status === 'pending_review').length}</strong></span></div>
              {overdueCustomers.map((customer) => <div className="debt-notice-row" key={customer.id}><span><AlertTriangle size={13} />{customer.id}: долг {formatTenge(customer.unpaidBalance)}</span><button className="text-action" onClick={() => void createSupplyReview(customer, 'disconnect')}>Запросить проверку отключения</button></div>)}
            </article>
          </section>

          <section className="primary-grid">
            <article className="panel network-panel">
              <div className="panel-heading">
                <div><div className="panel-kicker">ТОПОЛОГИЯ</div><h2>Однолинейная схема</h2></div>
                <button className="icon-button panel-menu" aria-label="Дополнительные действия" onClick={() => setNotice('Данные узлов загружены из БД; геометрия схемы задана в интерфейсе')}><MoreHorizontal size={19} /></button>
              </div>
              <div className="map-toolbar map-toolbar-controls">
                <span><span className="live-dot" />{stationRecords.length} подстанций <b>·</b>{equipmentLines.length} линий</span>
                <div className="map-filter-controls">
                  <select aria-label="Фильтр схемы по типу" value={mapTypeFilter} onChange={(event) => setMapTypeFilter(event.target.value as MapFilter)}>
                    <option value="all">Все типы</option><option value="substation">Подстанции</option><option value="line">Линии</option><option value="transformer">Трансформаторы</option>
                  </select>
                  <select aria-label="Фильтр схемы по состоянию" value={mapStatusFilter} onChange={(event) => setMapStatusFilter(event.target.value as StatusFilter)}>
                    <option value="all">Все состояния</option><option value="normal">Норма</option><option value="warning">Внимание</option><option value="critical">Авария</option>
                  </select>
                  <button className="map-mode-button" onClick={() => setDetailMode((mode) => !mode)}>{detailMode ? 'Общая схема' : 'Схема ПС'}</button>
                </div>
              </div>
              <NetworkMap selected={selectedElementId} onSelect={selectNetworkElement} typeFilter={mapTypeFilter} statusFilter={mapStatusFilter} detailMode={detailMode} stationId={selectedStation} stations={stationRecords} networkLines={equipmentLines} networkTransformer={transformerRecord} />
              <div className="selected-station">
                <div className={`station-status status-${selectedElement.status}`}><span /></div>
                <div className="selected-info"><strong>{selectedElement.name}</strong><span>ID: {selectedElement.id} · {selectedElement.kind} · {selectedElement.status}</span></div>
              </div>
              <div className="selected-measurements">
                {selectedMeasurement ? <><span>U <strong>{selectedMeasurement.voltage} кВ</strong></span><span>I <strong>{selectedMeasurement.current} А</strong></span><span>P <strong>{selectedMeasurement.activePower} МВт</strong></span><span>f <strong>{selectedMeasurement.frequency} Гц</strong></span><time>{lastMeasurementLabel}</time>{selectedMeasurement.qualityStatus === 'suspect' && <span className="quality-note">Качество: {selectedMeasurement.qualityFlags.join(', ')} · не авария</span>}</> : <span className="no-measurements">Нет измерений по выбранному элементу</span>}
              </div>
              <div className="selected-event-history"><span>ИСТОРИЯ СОБЫТИЙ</span>{relatedIncidents.length ? relatedIncidents.map((incident) => <span key={incident.id}>{incident.time} · {incident.title}</span>) : <span>Связанных событий нет</span>}</div>
            </article>

            <article className="panel incidents-panel" id="incident-list">
              <div className="panel-heading">
                <div><div className="panel-kicker">ДИСПЕТЧЕРСКАЯ</div><h2>События <span className="heading-count">{activeIncidents}</span></h2></div>
                <button className="text-action" onClick={() => void acknowledgeAllIncidents()}>Снять все</button>
              </div>
              <div className="incident-list">
                {incidents.filter((incident) => !incident.acknowledged).map((incident) => (
                  <div key={incident.id} className={`incident-row ${incident.acknowledged ? 'incident-acknowledged' : ''}`}>
                    <div className={`incident-marker ${incident.severity}`}>
                      {incident.severity === 'critical' ? <AlertTriangle size={14} /> : incident.severity === 'warning' ? <Activity size={14} /> : <ShieldCheck size={14} />}
                    </div>
                    <div className="incident-copy"><strong>{incident.title}</strong><span>{incident.detail}</span><time>{incident.time}</time></div>
                    {!incident.acknowledged && <button className="ack-button" onClick={() => acknowledgeIncident(incident.id)} aria-label={`Подтвердить: ${incident.title}`} title="Подтвердить событие"><Check size={15} /></button>}
                    {incident.acknowledged && <span className="ack-done"><Check size={14} /></span>}
                  </div>
                ))}
              </div>
              <button className="incident-footer" onClick={() => setActiveNav('Аварии')}>Открыть журнал аварий <span>→</span></button>
            </article>
          </section>

          <section className="secondary-grid">
            <article className="panel chart-panel">
              <div className="panel-heading chart-heading">
                <div><div className="panel-kicker">АНАЛИТИКА</div><h2>Нагрузка и напряжение</h2></div>
                <div className="range-control" role="group" aria-label="Период графика">
                  {['24 часа', '7 дней'].map((option) => <button key={option} className={range === option ? 'selected' : ''} onClick={() => setRange(option)}>{option}</button>)}
                </div>
              </div>
              <TrendChart range={range} />
            </article>

            <article className="panel assets-panel">
              <div className="panel-heading asset-heading">
                <div><div className="panel-kicker">УЗЛЫ СЕТИ</div><h2>Подстанции <span className="heading-count">{visibleStations.length}</span></h2></div>
                <label className="search-box"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" aria-label="Поиск подстанции" />{search && <button onClick={() => setSearch('')} aria-label="Очистить поиск"><X size={13} /></button>}</label>
              </div>
              <div className="asset-list">
                {visibleStations.map((station) => (
                  <button key={station.id} className={`asset-row ${selectedStation === station.id ? 'asset-selected' : ''}`} onClick={() => selectNetworkElement(station.id)}>
                    <span className={`asset-dot ${station.status}`} />
                    <span className="asset-name"><strong>{station.name}</strong><small>{station.voltage}</small></span>
                    <span className="asset-load"><span>{station.load}%</span><i><b style={{ width: `${station.load}%` }} className={station.status} /></i></span>
                    <span className={`asset-state ${station.status}`}>{station.status === 'normal' ? 'Норма' : station.status === 'warning' ? 'Внимание' : 'Авария'}</span>
                  </button>
                ))}
                {visibleStations.length === 0 && <div className="empty-state">Подстанции не найдены</div>}
              </div>
              <button className="asset-footer" onClick={() => { setActiveNav('Подстанции'); setNotice('Показаны подстанции, загруженные из базы') }}>Все оборудование <span>→</span></button>
            </article>
          </section>
          </>}

          {activeNav !== 'Дашборд руководителя' && <section className="workspace-view">
            {activeNav === 'Клиенты' && <>
              <article className="panel route-panel customer-panel">
                <div className="panel-heading asset-heading">
                  <div><div className="panel-kicker">ЛИЦЕВЫЕ СЧЕТА · УМНЫЕ СЧЁТЧИКИ</div><h2>Потребители <span className="heading-count">{visibleCustomers.length}</span></h2></div>
                  <div className="customer-actions"><label className="search-box"><Search size={14} /><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="ID, ФИО, адрес" aria-label="Поиск клиента" />{customerSearch && <button onClick={() => setCustomerSearch('')} aria-label="Очистить поиск"><X size={13} /></button>}</label><button className="button button-primary" onClick={() => setNewCustomerOpen((open) => !open)}><Users size={14} />Новый клиент</button></div>
                </div>
                <div className="customer-summary"><span>Начислено в этом месяце <strong>{formatTenge(monthlyCharges)}</strong></span><span>Потребление <strong>{monthlyConsumption.toLocaleString('ru-RU')} кВт·ч</strong></span><span>Demo тариф <strong>{tariffPerKwh.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₸/кВт·ч</strong></span></div>
                {newCustomerOpen && <form className="customer-create-form" onSubmit={(event) => { event.preventDefault(); addCustomer() }}>
                  <input value={customerNameDraft} onChange={(event) => setCustomerNameDraft(event.target.value)} placeholder="ФИО / организация" aria-label="ФИО или название клиента" />
                  <input value={customerAddressDraft} onChange={(event) => setCustomerAddressDraft(event.target.value)} placeholder="Адрес объекта" aria-label="Адрес объекта" />
                  <input value={customerBuildingDraft} onChange={(event) => setCustomerBuildingDraft(event.target.value)} placeholder="Дом / объект" aria-label="Дом или объект клиента" />
                  <button className="button button-primary" type="submit">Создать ID</button>
                </form>}
                <div className="customer-table">
                  <div className="customer-row customer-table-head"><span>КЛИЕНТ / ЛИЦЕВОЙ ID</span><span>АДРЕС / ОБЪЕКТ</span><span>СЧЁТЧИК</span><span>РАСХОД / НАЧИСЛЕНИЕ</span><span>ДОЛГ</span><span>СТАТУС ПИТАНИЯ</span><span>ЗАПРОСЫ В БД</span></div>
                  {visibleCustomers.map((customer) => <div className="customer-row" key={customer.id}>
                    <span className="customer-identity"><strong>{customer.name}</strong><small>{customer.id}</small></span>
                    <span className="customer-location">{customer.address}<small>{customer.building}</small></span>
                    <span className={`meter-state ${customer.meterStatus}`}><Radio size={13} />{customer.meterId}<small>{customer.meterStatus === 'online' ? 'На связи' : customer.meterStatus === 'stale' ? 'Нет новых данных' : 'Не подключён'}</small></span>
                    <span className="customer-billing"><strong>{customer.monthlyKwh} кВт·ч</strong><small>{formatTenge(customer.monthlyKwh * tariffPerKwh)}</small></span>
                    <span className={customer.unpaidBalance > 0 ? 'asset-state warning' : 'asset-state normal'}>{customer.unpaidBalance > 0 ? `Долг ${formatTenge(customer.unpaidBalance)}` : 'Оплачено'}</span>
                    <span className={`supply-status ${customer.supplyStatus}`}><Power size={13} />{customer.supplyStatus === 'connected' ? 'Включено в питание' : customer.supplyStatus === 'disconnected' ? 'Отключено от питания' : 'Не подтверждено'}<small>Учётный статус из БД</small></span>
                    <div className="supply-review-actions">
                      <button className="button button-secondary supply-review-button" disabled={supplyReviewCustomerId === customer.id || customer.supplyStatus === 'connected'} title="Зафиксировать подтверждённое состояние в БД; не управляет электричеством" onClick={() => void setCustomerSupplyStatus(customer, 'connected')}><Power size={12} />{supplyReviewCustomerId === customer.id ? 'Сохранение…' : 'Учесть: включено'}</button>
                      <button className="button button-secondary supply-review-button" disabled={supplyReviewCustomerId === customer.id || customer.supplyStatus === 'disconnected'} title="Зафиксировать подтверждённое состояние в БД; не управляет электричеством" onClick={() => void setCustomerSupplyStatus(customer, 'disconnected')}><Power size={12} />{supplyReviewCustomerId === customer.id ? 'Сохранение…' : 'Учесть: отключено'}</button>
                      <button className="button button-secondary supply-review-button" disabled={supplyReviewCustomerId === customer.id || customer.supplyStatus === 'unknown'} title="Сбросить неподтверждённую учётную отметку; не управляет электроснабжением" onClick={() => void setCustomerSupplyStatus(customer, 'unknown')}><X size={12} />Сбросить отметку</button>
                      {customer.unpaidBalance > 0
                        ? <button className="button button-secondary supply-review-button" disabled={supplyReviewCustomerId === customer.id || serviceRequests.some((request) => request.customerId === customer.id && request.kind === 'disconnection_review' && request.status !== 'completed')} title="Создать запрос на ручную проверку; отключение не выполняется" onClick={() => void createSupplyReview(customer, 'disconnect')}><Power size={12} />{serviceRequests.some((request) => request.customerId === customer.id && request.kind === 'disconnection_review' && request.status !== 'completed') ? 'Отключение: проверка' : 'Запросить отключение'}</button>
                        : <span className="supply-review-no-debt">Нет долга</span>}
                      <button className="button button-secondary supply-review-button" disabled={supplyReviewCustomerId === customer.id || serviceRequests.some((request) => request.customerId === customer.id && request.kind === 'reconnection_review' && request.status !== 'completed')} title="Создать запрос на ручную проверку; оборудование не переключается" onClick={() => void createSupplyReview(customer, 'reconnect')}><RefreshCw size={12} />{serviceRequests.some((request) => request.customerId === customer.id && request.kind === 'reconnection_review' && request.status !== 'completed') ? 'Восстановление: проверка' : 'Запросить включение'}</button>
                    </div>
                  </div>)}
                  {visibleCustomers.length === 0 && <div className="empty-state">Клиенты не найдены</div>}
                </div>
                <div className="customer-policy"><AlertTriangle size={14} />«Статус питания» — учётная отметка из БД. Кнопки «Учесть» меняют только её и не управляют электричеством. Запросы отключения/включения создают отдельные заявки на ручную проверку.</div>
              </article>
              {serviceFormOpen && <article className="panel route-panel request-form-panel">
                <div className="panel-heading"><div><div className="panel-kicker">РУЧНАЯ ПРОВЕРКА</div><h2>Новая заявка на обслуживание</h2></div><button className="icon-button" onClick={() => setServiceFormOpen(false)} aria-label="Закрыть форму"><X size={16} /></button></div>
                <div className="request-form-controls"><label>Клиент<select value={serviceFormCustomerId} onChange={(event) => setServiceFormCustomerId(event.target.value)}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.id} · {customer.name}</option>)}</select></label><label>Тип заявки<select value={serviceFormKind} onChange={(event) => setServiceFormKind(event.target.value as typeof serviceFormKind)}><option value="new_connection">Новое подключение · проверка</option><option value="disconnection_review">Проверка неоплаты · без автоотключения</option><option value="remote_switch_review">Запрос на переключение · согласование</option></select></label><button className="button button-primary" onClick={() => { const selectedCustomer = customers.find((customer) => customer.id === serviceFormCustomerId); const summary = serviceFormKind === 'new_connection' ? 'Новое подключение, требуется выезд и проверка' : serviceFormKind === 'disconnection_review' ? `Проверить задолженность ${formatTenge(selectedCustomer?.unpaidBalance ?? 0)} и уведомление` : 'Запрос на переключение, требуется инженерное согласование'; openServiceRequest(serviceFormKind, serviceFormCustomerId, summary); setServiceFormOpen(false) }}>Передать на проверку</button></div>
              </article>}
            </>}

            {activeNav === 'Заявки' && <article className="panel route-panel request-list-panel">
              <div className="panel-heading"><div><div className="panel-kicker">ОБСЛУЖИВАНИЕ · РУЧНАЯ ОБРАБОТКА</div><h2>Заявки <span className="heading-count">{serviceRequests.length}</span></h2></div><button className="button button-primary" onClick={() => { setActiveNav('Клиенты'); setServiceFormOpen(true) }}><ClipboardList size={14} />Создать заявку</button></div>
              <div className="service-request-list">{serviceRequests.map((request) => {
                const customer = customers.find((item) => item.id === request.customerId)
                const kindLabel = request.kind === 'new_connection' ? 'Подключение' : request.kind === 'disconnection_review' ? 'Проверка отключения' : request.kind === 'reconnection_review' ? 'Проверка восстановления' : request.kind === 'remote_switch_review' ? 'Согласование переключения' : 'Ремонтный выезд'
                const isSupplyReview = request.kind === 'disconnection_review' || request.kind === 'reconnection_review'
                const statusLabel = request.status === 'pending_review' ? 'Ожидает проверки' : request.status === 'assigned' ? 'Назначена сотруднику' : isSupplyReview ? 'Проверка завершена · без переключения' : 'Работы отмечены выполненными'
                return <div className="service-request-row" key={request.id}><div className="request-kind-icon"><ClipboardList size={16} /></div><div className="service-request-copy"><strong>{request.id} · {kindLabel}</strong><span>{customer?.id} · {customer?.name} · {request.summary}</span><small>{new Date(request.createdAt).toLocaleString('ru-RU')}</small></div><span className={`request-status ${request.status}`}>{statusLabel}</span>{request.status === 'pending_review' && <button className="button button-secondary" onClick={() => updateRequestStatus(request.id, 'assigned')}>Назначить</button>}{isSupplyReview && request.status === 'assigned' && <button className="button button-secondary" onClick={() => updateRequestStatus(request.id, 'completed')}>Завершить проверку</button>}{request.kind === 'repair' && request.status === 'assigned' && <button className="button button-secondary" onClick={() => updateRequestStatus(request.id, 'completed')}>Закрыть выезд</button>}</div>
              })}</div>
              <div className="customer-policy"><ShieldCheck size={14} />Подключение, отключение и сетевые переключения здесь только регистрируются и требуют ручного утверждения уполномоченным персоналом.</div>
            </article>}

            {activeNav === 'Ремонтные бригады' && <div className="workspace-view">
              <article className="panel route-panel repair-request-entry">
                <div className="panel-heading"><div><div className="panel-kicker">ОБРАЩЕНИЕ ПО НЕИСПРАВНОСТИ</div><h2>Нужен ремонт?</h2></div><button className="button button-primary" onClick={() => setRepairRequestOpen((open) => !open)}><Wrench size={14} />{repairRequestOpen ? 'Скрыть форму' : 'Оставить заявку'}</button></div>
                {repairRequestOpen && <form className="repair-request-form" onSubmit={(event) => { event.preventDefault(); submitRepairRequest() }}>
                  <label>Лицевой счёт<select value={repairRequestCustomerId} onChange={(event) => setRepairRequestCustomerId(event.target.value)}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.id} · {customer.name} · {customer.address}</option>)}</select></label>
                  <label>Приоритет<select value={repairRequestPriority} onChange={(event) => setRepairRequestPriority(event.target.value as typeof repairRequestPriority)}><option value="normal">Плановая</option><option value="urgent">Срочная проверка</option></select></label>
                  <label className="repair-description-label">Что случилось?<textarea value={repairRequestDescription} onChange={(event) => setRepairRequestDescription(event.target.value)} placeholder="Например: нет электричества в квартире, искрит розетка, повреждён вводной кабель" minLength={8} required /></label>
                  <div className="repair-request-submit"><span>Заявка будет проверена диспетчером; автоматическое переключение сети не выполняется.</span><button className="button button-primary" type="submit"><Send size={14} />Отправить заявку</button></div>
                </form>}
              </article>
              <div className="repair-crew-grid">{repairCrews.map((crew, index) => <article className="panel repair-crew-card" key={crew.id}><div className="crew-card-top"><div className="crew-icon"><Wrench size={17} /></div><span className={`request-status ${crew.status === 'Свободна' ? 'assigned' : 'pending_review'}`}>{crew.status}</span></div><div className="panel-kicker">{crew.id}</div><h2>{crew.name}</h2><p>{crew.skill}</p><span className="crew-district"><Map size={13} />{crew.district}</span><span className="crew-district">{crew.contact}</span><button className="button button-secondary" onClick={() => { const customer = customers[index % Math.max(customers.length, 1)]; if (customer) void openServiceRequest('repair', customer.id, `Выезд: ${crew.name} · осмотр объекта`, 'assigned') }}><ClipboardList size={14} />Назначить выезд</button></article>)}</div>
              <article className="panel route-panel"><div className="panel-heading"><div><div className="panel-kicker">НАРЯДЫ</div><h2>Ремонтные заявки</h2></div></div><div className="service-request-list">{serviceRequests.filter((request) => request.kind === 'repair').map((request) => <div className="service-request-row" key={request.id}><Wrench size={15} /><div className="service-request-copy"><strong>{request.id} · {request.summary}</strong><span>{request.customerId}</span></div><span className={`request-status ${request.status}`}>{request.status === 'completed' ? 'Осмотр завершён' : request.status === 'assigned' ? 'Бригада назначена' : 'Ожидает назначения'}</span></div>)}{serviceRequests.every((request) => request.kind !== 'repair') && <div className="empty-state">Ремонтных заявок пока нет</div>}</div></article>
            </div>}

            {activeNav === 'Схема сети' && <>
              <div className="network-page-intro">
                <div><div className="panel-kicker">ИНТЕРАКТИВНАЯ ТОПОЛОГИЯ · OPENSTREETMAP</div><h2>Схема электроснабжения Кокшетау</h2></div>
                <span>Состояния ПС и аварии загружаются из БД; геометрия связей и координаты объектов — демонстрационные.</span>
              </div>
              <Suspense fallback={<div className="network-map-loading">Загрузка карты сети…</div>}>
                <NetworkMapView
                  stations={stationRecords}
                  networkLines={equipmentLines}
                  transformer={transformerRecord}
                  incidents={incidents}
                  customers={customers}
                />
              </Suspense>
            </>}


            {activeNav === 'Корпоративный портал' && <div className="portal-grid">
              <article className="panel portal-account-panel">
                <div className="panel-heading"><div><div className="panel-kicker">ЛИЧНЫЙ КАБИНЕТ</div><h2>Потребитель</h2></div><div className="profile-avatar"><Users size={15} /></div></div>
                <label className="portal-customer-select">Лицевой счёт<select value={portalCustomerId} onChange={(event) => setPortalCustomerId(event.target.value)}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.id} · {customer.name}</option>)}</select></label>
                {portalCustomer && <div className="portal-bill"><span>К оплате за ноябрь</span><strong>{formatTenge(portalCustomer.monthlyKwh * tariffPerKwh)}</strong><small>{portalCustomer.monthlyKwh} кВт·ч · demo тариф {tariffPerKwh.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₸/кВт·ч</small><span className={portalCustomer.unpaidBalance ? 'asset-state warning' : 'asset-state normal'}>{portalCustomer.unpaidBalance ? `Есть долг ${formatTenge(portalCustomer.unpaidBalance)}` : 'Задолженности нет'}</span></div>}
                {portalCustomer && <div className="portal-meter-info"><span><Radio size={14} />Счётчик {portalCustomer.meterId}</span><span>{portalCustomer.monthlyKwh} кВт·ч в этом месяце</span><span>{portalCustomer.previousKwh} кВт·ч в прошлом месяце</span></div>}
                <div className="customer-policy"><ShieldCheck size={14} />Данные демонстрационные; платёж не выполняется.</div>
              </article>
              <article className="panel portal-chat-panel">
                <div className="panel-heading"><div><div className="panel-kicker">КОНСУЛЬТАЦИЯ</div><h2>{supportMode === 'assistant' ? 'ИИ-ассистент' : 'Онлайн-консультация'}</h2></div><div className="range-control"><button className={supportMode === 'assistant' ? 'selected' : ''} onClick={() => setSupportMode('assistant')}><Sparkles size={13} />ИИ</button><button className={supportMode === 'operator' ? 'selected' : ''} onClick={() => setSupportMode('operator')}><Headset size={13} />Оператор</button></div></div>
                {(supportMode === 'assistant' || !isSupportAgent) && <>
                  <div className="support-message-list" aria-live="polite">{(supportMode === 'assistant' ? supportMessages : operatorChatMessages).map((message) => <div key={message.id} className={`support-message ${message.sender}`}><span>{message.text}</span><time>{message.time}</time></div>)}</div>
                  <form className="support-compose" onSubmit={(event) => { event.preventDefault(); void sendSupportMessage() }}><input value={supportDraft} maxLength={4000} onChange={(event) => setSupportDraft(event.target.value)} placeholder={supportMode === 'assistant' ? 'Спросите о счёте, расходе или заявке' : 'Напишите сообщение оператору'} aria-label="Сообщение в поддержку" /><button className="icon-button" type="submit" disabled={supportMode === 'operator' && (supportSending || supportStatus === 'connecting')} aria-label="Отправить сообщение"><Send size={16} /></button></form>
                  <p className="support-demo-note">{supportMode === 'assistant'
                    ? 'ИИ-ассистент работает в демо-режиме · не передавайте платёжные данные'
                    : supportStatus === 'connecting'
                      ? 'Подключение к службе поддержки…'
                      : supportStatus === 'unavailable'
                        ? 'Служба поддержки недоступна. Сообщение не отправлено.'
                        : operatorsOnline === 0
                          ? 'Обращение подключено и сохранено. Сейчас операторов онлайн нет.'
                          : operatorsOnline === null
                            ? 'Обращение подключено. Ожидайте ответа оператора.'
                            : 'Обращение подключено. Операторов онлайн: ' + operatorsOnline}</p>
                </>}
                {supportMode === 'operator' && isSupportAgent && <div className="support-operator-console">
                  <div className="support-operator-heading"><strong>Очередь обращений</strong><span>{supportConversations.length} открыто</span></div>
                  {supportConversations.length === 0
                    ? <div className="support-operator-empty">Новых обращений нет</div>
                    : <div className="support-operator-list">{supportConversations.map((conversation) => <div className={`support-operator-row ${selectedOperatorConversation === conversation.id ? 'selected' : ''}`} key={conversation.id}>
                      <button type="button" className="support-operator-select" onClick={() => selectOperatorConversation(conversation.id)}><strong>{conversation.customerId}</strong><span>{conversation.title}</span></button>
                      <button type="button" className="button button-secondary" onClick={() => void assignOperatorConversation(conversation.id)}>{conversation.assignedTo ? 'Назначено' : 'Взять'}</button>
                    </div>)}</div>}
                  {selectedOperatorConversation && <><div className="support-message-list support-operator-messages" aria-live="polite">{operatorMessages.map((message) => <div key={message.id} className={`support-message ${message.sender}`}><span>{message.text}</span><time>{message.time}</time></div>)}</div>
                    <form className="support-compose" onSubmit={(event) => { event.preventDefault(); void sendOperatorReply() }}><input value={operatorDraft} maxLength={4000} onChange={(event) => setOperatorDraft(event.target.value)} placeholder="Ответить клиенту" aria-label="Ответ оператора" /><button className="icon-button" type="submit" disabled={operatorSending} aria-label="Отправить ответ"><Send size={16} /></button></form></>}
                </div>}
              </article>
            </div>}
            {activeNav === 'Подстанции' && <article className="panel route-panel">
              <div className="panel-heading"><div><div className="panel-kicker">ОБОРУДОВАНИЕ</div><h2>Подстанции <span className="heading-count">{visibleStations.length}</span></h2></div><label className="search-box"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" aria-label="Поиск подстанции" /></label></div>
              <div className="asset-list route-asset-list">{visibleStations.map((station) => <button key={station.id} className={`asset-row ${selectedStation === station.id ? 'asset-selected' : ''}`} onClick={() => selectNetworkElement(station.id)}><span className={`asset-dot ${station.status}`} /><span className="asset-name"><strong>{station.name}</strong><small>ID: {station.id} · {station.location}</small></span><span className="asset-load"><span>{station.voltage}</span></span><span className={`asset-state ${station.status}`}>{station.load}%</span></button>)}</div>
              <div className="route-selection"><strong>Выбрана: {stationRecords.find((station) => station.id === selectedStation)?.name ?? 'Подстанция не загружена'}</strong><span>Связанные элементы: {equipmentLines.filter((line) => line.from === selectedStation || line.to === selectedStation).map((line) => `${line.label} (${line.id})`).join(', ') || 'нет линий'}</span>{transformerRecord && selectedStation === transformerRecord.stationId && <span>{transformerRecord.name} · ID {transformerRecord.id}</span>}</div>
            </article>}

            {activeNav === 'Телеметрия' && <div className="workspace-view">
              <div className="route-grid">
                <article className="panel chart-panel route-panel">
                  <div className="panel-heading chart-heading"><div><div className="panel-kicker">ИСТОРИЯ ИЗМЕРЕНИЙ</div><h2>Нагрузка и напряжение</h2></div><div className="range-control" role="group" aria-label="Период графика">{['24 часа', '7 дней'].map((option) => <button key={option} className={range === option ? 'selected' : ''} onClick={() => setRange(option)}>{option}</button>)}</div></div>
                  <TrendChart range={range} />
                </article>
                <article className="panel route-panel source-details">
                  <div className="panel-heading"><div><div className="panel-kicker">ИСТОЧНИКИ</div><h2>Состояние телеметрии</h2></div></div>
                  <div className="route-selection"><strong className={`source-${telemetryFreshness}`}>{telemetryStatusLabel(telemetryFreshness, Boolean(latestMeasurement))}</strong><span>Связь с источником: {sourceConnectionLabel(telemetrySourceStatus)}</span><span>Последнее измерение: {lastMeasurementLabel}</span>{latestMeasurement && <span>{latestMeasurement.voltage} кВ · {latestMeasurement.current} А · {latestMeasurement.activePower} МВт · {latestMeasurement.frequency} Гц</span>}{latestMeasurement?.qualityStatus === 'suspect' && <span className="source-suspect">Проверить: {latestMeasurement.qualityFlags.join(', ')} · не авария</span>}</div>
                </article>
              </div>
              <QualityEventsPanel events={qualityEvents} available={qualityEventsAvailable} />
            </div>}

            {activeNav === 'Аварии' && <article className="panel route-panel incidents-panel route-incidents"><div className="panel-heading"><div><div className="panel-kicker">ЖУРНАЛ СОБЫТИЙ</div><h2>Предупреждения и аварии <span className="heading-count">{activeIncidents}</span></h2></div><button className="text-action" onClick={() => void acknowledgeAllIncidents()}>Снять все</button></div><div className="incident-list">{incidents.map((incident) => <div key={incident.id} className={`incident-row ${incident.acknowledged ? 'incident-acknowledged' : ''}`}><div className={`incident-marker ${incident.severity}`}>{incident.severity === 'critical' ? <AlertTriangle size={14} /> : incident.severity === 'warning' ? <Activity size={14} /> : <ShieldCheck size={14} />}</div><div className="incident-copy"><strong>{incident.title}</strong><span>{incident.detail} · {incident.equipmentId}</span><time>{incident.time}</time></div>{!incident.acknowledged && <button className="ack-button" onClick={() => acknowledgeIncident(incident.id)} aria-label={`Подтвердить: ${incident.title}`}><Check size={15} /></button>}</div>)}</div></article>}

            {activeNav === 'Отчёты' && <div className="route-grid"><article className="panel route-panel report-summary"><div className="panel-heading"><div><div className="panel-kicker">СВОДКА ПО СЕТИ</div><h2>Нагрузка и потребление</h2></div><button className="button button-primary" onClick={exportReport}><Download size={15} />Экспорт CSV</button></div><TrendChart range={range} /><div className="report-stats"><span><strong>{latestMeasurement ? `${latestMeasurement.activePower.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МВт` : '—'}</strong><small>последняя активная мощность</small></span><span><strong>{stationRecords.length}</strong><small>подстанций в сводке</small></span><span><strong>{activeIncidents}</strong><small>активных событий</small></span></div></article><article className="panel route-panel"><div className="panel-heading"><div><div className="panel-kicker">ДАННЫЕ</div><h2>Состояние отчёта</h2></div></div><div className="route-selection"><strong>Сведения из базы данных</strong><span>Экспорт включает загруженный справочник подстанций и их состояния.</span><span>Последнее измерение: {lastMeasurementLabel}</span></div></article></div>}

            {activeNav === 'Пользователи' && <article className="panel route-panel">
              <div className="panel-heading">
                <div><div className="panel-kicker">ЛОКАЛЬНЫЕ УЧЁТНЫЕ ЗАПИСИ</div><h2>Пользователи и роли <span className="heading-count">{users.length}</span></h2></div>
              </div>
              <div className="customer-policy"><ShieldCheck size={14} />Создавайте отдельный логин и пароль для каждого потребителя. Пароль хранится только в виде хеша.</div>
              <form className="customer-account-form" onSubmit={(event) => { event.preventDefault(); void createCustomerAccount() }}>
                <label>Лицевой счёт
                  <select
                    value={accountCustomerId}
                    onChange={(event) => {
                      const customerId = event.target.value
                      setAccountCustomerId(customerId)
                      setAccountUsername(customerId.toLowerCase())
                    }}
                    required
                    disabled={creatingCustomerAccount || customers.every((customer) => customer.hasAccount)}
                  >
                    {customers.filter((customer) => !customer.hasAccount).map((customer) =>
                      <option key={customer.id} value={customer.id}>{customer.id} · {customer.name}</option>,
                    )}
                  </select>
                </label>
                <label>Логин
                  <input
                    value={accountUsername}
                    onChange={(event) => setAccountUsername(event.target.value)}
                    minLength={3}
                    maxLength={32}
                    pattern="[a-zA-Z0-9._-]+"
                    autoComplete="off"
                    required
                    disabled={creatingCustomerAccount || !accountCustomerId}
                  />
                </label>
                <label>Пароль для потребителя
                  <input
                    type="password"
                    value={accountPassword}
                    onChange={(event) => setAccountPassword(event.target.value)}
                    minLength={10}
                    maxLength={128}
                    autoComplete="new-password"
                    required
                    disabled={creatingCustomerAccount || !accountCustomerId}
                  />
                </label>
                <button className="button button-primary" type="submit" disabled={creatingCustomerAccount || !accountCustomerId}>
                  {creatingCustomerAccount ? 'Создание…' : 'Создать аккаунт'}
                </button>
                {customers.length > 0 && customers.every((customer) => customer.hasAccount) && <span className="customer-policy">У всех существующих лицевых счетов уже есть аккаунты.</span>}
              </form>
              <div className="user-table">
                <div className="user-row user-table-head"><span>ПОЛЬЗОВАТЕЛЬ</span><span>ЛОГИН</span><span>РОЛЬ</span></div>
                {users.map((user) => <div className="user-row" key={user.subject}>
                  <strong>{user.displayName}</strong>
                  <span>{user.username}</span>
                  <select className="user-role-select" aria-label={`Роль пользователя ${user.username}`} value={user.role} onChange={(event) => void changeUserRole(user, event.target.value as UserRole)}>
                    <option value="customer">Потребитель</option>
                    <option value="operator">Диспетчер</option>
                    <option value="engineer">Инженер</option>
                    <option value="administrator">Администратор</option>
                  </select>
                </div>)}
                {users.length === 0 && <div className="empty-state">Локальные аккаунты не найдены</div>}
              </div>
            </article>}

            {activeNav === 'Настройки' && <article className="panel route-panel"><div className="panel-heading"><div><div className="panel-kicker">ЛОКАЛЬНАЯ СИСТЕМА</div><h2>Параметры системы</h2></div></div><div className="integration-list"><div><span className={`source-indicator source-${backendAvailable === null ? 'checking' : backendAvailable ? 'fresh' : 'offline'}`} /><strong>Локальный API</strong><small>{backendAvailable === null ? 'Проверка' : backendAvailable ? 'Доступен' : 'Недоступен'}</small></div><div><span className="source-indicator source-fresh" /><strong>Вход в систему</strong><small>Локальные логин и пароль · внешние провайдеры отключены</small></div><div><span className={`source-indicator source-${telemetryFreshness}`} /><strong>Источник телеметрии</strong><small>{telemetryStatusLabel(telemetryFreshness, Boolean(latestMeasurement))} · {telemetrySourceStatus}</small></div><div><span className={`source-indicator source-${databaseAvailable === null ? 'checking' : databaseAvailable ? 'fresh' : 'offline'}`} /><strong>PostgreSQL</strong><small>{databaseAvailable === null ? 'Проверка' : databaseAvailable ? 'Доступна' : 'Недоступна'} · для учётных записей не требуется</small></div></div></article>}
          </section>}

          <footer className="page-footer"><span><span className={`source-indicator source-${telemetryFreshness}`} />{telemetryStatusLabel(telemetryFreshness, Boolean(latestMeasurement))} · Демо-режим</span><span>PowerGrid Monitor <b>v0.1.0</b><i>·</i>Последнее измерение {lastMeasurementLabel}</span></footer>
        </div>
      </main>
      {notice && <div className="toast" role="status"><Check size={15} />{notice}<button onClick={() => setNotice('')} aria-label="Закрыть уведомление"><X size={14} /></button></div>}
    </div>
  )
}

function DashboardPage() {
  const [currentUser, setCurrentUser] = useState<LocalUser | null>(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authRetry, setAuthRetry] = useState(0)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const status = await api.getAuthStatus()
        if (!active) return
        setSetupRequired(status.setupRequired)
        const token = authToken.get()
        if (token) {
          try {
            const user = await api.getCurrentUser()
            if (active) setCurrentUser(user)
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 401) throw error
            authToken.clear()
          }
        }
        if (active) setAuthError('')
      } catch {
        if (active) setAuthError('Не удалось подключиться к локальному серверу. Проверьте запуск start-demo.bat.')
      } finally {
        if (active) setAuthReady(true)
      }
    })()
    return () => { active = false }
  }, [authRetry])

  const handleAuthenticated = (session: AuthSession) => {
    authToken.set(session.accessToken)
    setCurrentUser(session.user)
    setSetupRequired(false)
    setAuthError('')
  }

  const handleLogout = () => {
    authToken.clear()
    setCurrentUser(null)
    setSetupRequired(false)
  }

  if (!authReady) {
    return <main className="auth-page"><section className="auth-card auth-loading">Подключение к локальному серверу…</section></main>
  }
  if (!currentUser) {
    return <AuthPage
      setupRequired={setupRequired}
      serverError={authError}
      onAuthenticated={handleAuthenticated}
      onRetry={() => { setAuthReady(false); setAuthRetry((count) => count + 1) }}
    />
  }
  return <DashboardContent currentUser={currentUser} onLogout={handleLogout} />
}

export default DashboardPage