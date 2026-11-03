import { Fragment, useEffect, useMemo, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  ZoomControl,
  useMap,
} from 'react-leaflet'
import { divIcon, type LatLngTuple } from 'leaflet'
import {
  AlertTriangle,
  Building2,
  Cable,
  ChevronDown,
  CircleHelp,
  Factory,
  Gauge,
  MapPin,
  Search,
  ShieldAlert,
  Zap,
} from 'lucide-react'

type AssetStatus = 'normal' | 'warning' | 'critical' | 'unknown'
type AssetKind = 'source' | 'station' | 'transformer' | 'tp' | 'building'
type FeatureKind = AssetKind | 'generation' | 'line' | 'feeder'

type Station = {
  id: string
  name: string
  location: string
  voltage: string
  load: number
  status: Exclude<AssetStatus, 'unknown'>
}

type NetworkLine = {
  id: string
  label: string
  from: string
  to: string
  status: Exclude<AssetStatus, 'unknown'>
}

type Transformer = {
  id: string
  name: string
  status: Exclude<AssetStatus, 'unknown'>
  stationId: string
} | null

type Incident = {
  id: string
  title: string
  equipmentId: string
  time: string
  severity: 'critical' | 'warning' | 'info'
  acknowledged: boolean
}

type Customer = {
  id: string
  address: string
  building: string
  supplyStatus: 'unknown' | 'connected' | 'disconnected'
}

type MapObject = {
  id: string
  name: string
  kind: AssetKind
  status: AssetStatus
  position: LatLngTuple
  stationId: string
  voltage: string
  address?: string
  load?: number
  tpId?: string
  demo: true
}

type MapLine = {
  id: string
  name: string
  kind: 'generation' | 'line' | 'feeder'
  status: AssetStatus
  voltage: string
  positions: LatLngTuple[]
  stationIds: string[]
  fromId: string
  toId: string
  demo: true
}

const cityCenter: LatLngTuple = [53.2833, 69.3833]
const sourcePosition: LatLngTuple = [53.29, 69.338]
const generatorPosition: LatLngTuple = [53.291, 69.342]
const stepUpPosition: LatLngTuple = [53.292, 69.346]

const knownStationPositions: Record<string, LatLngTuple> = {
  north: [53.301, 69.39],
  central: [53.286, 69.382],
  east: [53.285, 69.405],
  south: [53.265, 69.388],
  west: [53.282, 69.36],
}

const statusLabels: Record<AssetStatus, string> = {
  normal: 'Норма',
  warning: 'Нестабильно',
  critical: 'Нет питания / авария',
  unknown: 'Нет данных',
}

const kindLabels: Record<FeatureKind, string> = {
  source: 'Источник · DEMO',
  station: 'Подстанция',
  transformer: 'Трансформатор',
  generation: 'Генерация · DEMO',
  tp: 'ТП · DEMO',
  building: 'Здание · DEMO',
  line: 'Линия',
  feeder: 'Распределительный фидер · DEMO',
}

const statusColor: Record<AssetStatus, string> = {
  normal: '#91c977',
  warning: '#e9b65c',
  critical: '#ef625d',
  unknown: '#98a3aa',
}

function stationPosition(stationId: string, index: number): LatLngTuple {
  const known = knownStationPositions[stationId]
  if (known) return known
  const angle = index * 2.4
  const radius = 0.012 + (index % 3) * 0.003
  return [
    cityCenter[0] + Math.sin(angle) * radius,
    cityCenter[1] + Math.cos(angle) * radius,
  ]
}

function offsetPosition(position: LatLngTuple, row: number, column: number): LatLngTuple {
  return [position[0] + row * 0.0015, position[1] + column * 0.0018]
}

function buildingPolygon(position: LatLngTuple): LatLngTuple[] {
  const half = 0.00024
  return [
    [position[0] - half, position[1] - half],
    [position[0] - half, position[1] + half],
    [position[0] + half, position[1] + half],
    [position[0] + half, position[1] - half],
  ]
}

function MapFocus({ position }: { position: LatLngTuple | null }) {
  const map = useMap()
  useEffect(() => {
    if (position) map.flyTo(position, Math.max(map.getZoom(), 14), { duration: 0.45 })
  }, [map, position])
  return null
}

function DirectionArrow({ positions, color }: { positions: LatLngTuple[]; color: string }) {
  const segment = Math.max(0, Math.floor((positions.length - 1) / 2))
  const start = positions[segment]
  const end = positions[Math.min(segment + 1, positions.length - 1)]
  if (!start || !end) return null
  const position: LatLngTuple = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
  const longitudeScale = Math.cos(position[0] * Math.PI / 180)
  const angle = Math.atan2(-(end[0] - start[0]), (end[1] - start[1]) * longitudeScale) * 180 / Math.PI
  const icon = divIcon({
    className: 'network-direction-icon',
    html: `<span style="color:${color};transform:rotate(${angle}deg)">➤</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
  return <Marker position={position} icon={icon} interactive={false} keyboard={false} pane="markerPane" />
}

function objectRadius(kind: AssetKind) {
  if (kind === 'source') return 9
  if (kind === 'station') return 8
  if (kind === 'transformer') return 7
  if (kind === 'tp') return 5
  return 4
}

function lineColor(line: MapLine) {
  if (line.status === 'critical') return statusColor.critical
  if (line.status === 'warning') return statusColor.warning
  if (line.kind === 'generation') return '#b7a4ef'
  if (line.voltage.includes('110')) return '#f49a32'
  if (line.voltage.includes('0,4')) return '#8fc77c'
  return '#4ea9ed'
}

function nodeLabel(nodeId: string, objects: MapObject[], stations: Station[]) {
  return objects.find((object) => object.id === nodeId)?.name
    ?? stations.find((station) => station.id === nodeId)?.name
    ?? nodeId
}

export default function NetworkMapView({
  stations,
  networkLines,
  transformer,
  incidents,
  customers,
}: {
  stations: Station[]
  networkLines: NetworkLine[]
  transformer: Transformer
  incidents: Incident[]
  customers: Customer[]
}) {
  const [selectedId, setSelectedId] = useState('source-tes-demo')
  const [selectedCustomerId, setSelectedCustomerId] = useState('')
  const [scopeId, setScopeId] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [voltageFilter, setVoltageFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [incidentOnly, setIncidentOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [scenarioOutages, setScenarioOutages] = useState<Set<string>>(() => new Set())

  const availableStations = useMemo(() => stations.map((station, index) => ({
    ...station,
    position: stationPosition(station.id, index),
  })), [stations])

  const reachableStationIds = useMemo(() => {
    const stationsById = new globalThis.Map(availableStations.map((station) => [station.id, station] as const))
    const excluded = new Set(scenarioOutages)
    const rootId = stationsById.has('north') ? 'north' : availableStations[0]?.id
    const reached = new Set<string>()
    const sourcePathOut = [
      'source-tes-demo',
      'generator-demo',
      'step-up-transformer-demo',
      'demo-tes-generator',
      'demo-generator-transformer',
      'demo-source-110',
    ].some((id) => excluded.has(id))
    const unavailableStations = new Set(availableStations
      .filter((station) => station.status === 'critical' || excluded.has(station.id))
      .map((station) => station.id))
    if (transformer && (transformer.status === 'critical' || excluded.has(transformer.id))) {
      unavailableStations.add(transformer.stationId)
    }
    if (!rootId || sourcePathOut || unavailableStations.has(rootId)) return reached
    reached.add(rootId)
    let changed = true
    while (changed) {
      changed = false
      for (const line of networkLines) {
        if (excluded.has(line.id) || line.status === 'critical') continue
        if (reached.has(line.from) && stationsById.has(line.to) && !unavailableStations.has(line.to) && !reached.has(line.to)) {
          reached.add(line.to)
          changed = true
        }
        if (reached.has(line.to) && stationsById.has(line.from) && !unavailableStations.has(line.from) && !reached.has(line.from)) {
          reached.add(line.from)
          changed = true
        }
      }
    }
    return reached
  }, [availableStations, networkLines, scenarioOutages, transformer])

  const objects = useMemo<MapObject[]>(() => {
    const sourceObjects: MapObject[] = [
      { id: 'source-tes-demo', name: 'ТЭС Кокшетау · DEMO', kind: 'source', status: scenarioOutages.has('source-tes-demo') ? 'critical' : 'unknown', position: sourcePosition, stationId: '', voltage: 'Источник', demo: true },
      { id: 'generator-demo', name: 'Генератор · DEMO', kind: 'source', status: scenarioOutages.has('generator-demo') ? 'critical' : 'unknown', position: generatorPosition, stationId: '', voltage: 'Генератор', demo: true },
      { id: 'step-up-transformer-demo', name: 'Повышающий трансформатор · DEMO', kind: 'source', status: scenarioOutages.has('step-up-transformer-demo') ? 'critical' : 'unknown', position: stepUpPosition, stationId: '', voltage: 'Условно 110 кВ', demo: true },
    ]
    const stationObjects: MapObject[] = availableStations.map((station) => ({
      id: station.id,
      name: station.name,
      kind: 'station',
      status: station.status,
      position: station.position,
      stationId: station.id,
      voltage: station.voltage,
      address: station.location,
      load: station.load,
      demo: true,
    }))
    const transformerObjects: MapObject[] = transformer
      ? [{
        id: transformer.id,
        name: transformer.name,
        kind: 'transformer',
        status: transformer.status,
        position: offsetPosition(availableStations.find((station) => station.id === transformer.stationId)?.position ?? cityCenter, 1, 1),
        stationId: transformer.stationId,
        voltage: 'Не указано в реестре',
        demo: true,
      }]
      : []

    const distributionObjects: MapObject[] = []
    for (const station of availableStations) {
      for (let feederIndex = 0; feederIndex < 2; feederIndex += 1) {
        const tpId = `tp-demo-${station.id}-${feederIndex + 1}`
        const tpPosition = offsetPosition(station.position, feederIndex === 0 ? 1 : -1, feederIndex === 0 ? 1 : -1)
        const stationReachable = reachableStationIds.has(station.id)
        const tpStatus: AssetStatus = !stationReachable
          ? 'critical'
          : scenarioOutages.has(tpId)
            ? 'critical'
            : station.status === 'warning'
              ? 'warning'
            : feederIndex === 1 && station.id === 'west'
              ? 'unknown'
              : 'normal'
        distributionObjects.push({
          id: tpId,
          name: `ТП ${station.id.toUpperCase()}-${feederIndex + 1} · DEMO`,
          kind: 'tp',
          status: tpStatus,
          position: tpPosition,
          stationId: station.id,
          voltage: '6–10 / 0,4 кВ',
          address: `Условная зона: ${station.location}`,
          demo: true,
        })

        for (let buildingIndex = 0; buildingIndex < 4; buildingIndex += 1) {
          const position = offsetPosition(tpPosition, (buildingIndex % 2) * 0.6 - 0.3, Math.floor(buildingIndex / 2) * 0.6 - 0.3)
          const buildingId = `building-demo-${station.id}-${feederIndex + 1}-${buildingIndex + 1}`
          const demoAddress = `Демо-объект · сектор ${station.id} · зона ${feederIndex + 1} · дом ${buildingIndex + 1}`
          const buildingStatus: AssetStatus = !stationReachable || scenarioOutages.has(tpId) || scenarioOutages.has(buildingId)
            ? 'critical'
            : station.status === 'warning'
              ? 'warning'
              : buildingIndex === 3 && feederIndex === 1
                ? 'unknown'
                : 'normal'
          distributionObjects.push({
            id: buildingId,
            name: `Здание ${station.id.toUpperCase()}-${feederIndex + 1}-${buildingIndex + 1} · DEMO`,
            kind: 'building',
            status: buildingStatus,
            position,
            stationId: station.id,
            voltage: '0,4 кВ',
            address: demoAddress,
            tpId,
            demo: true,
          })
        }
      }
    }

    return [...sourceObjects, ...stationObjects, ...transformerObjects, ...distributionObjects]
  }, [availableStations, reachableStationIds, scenarioOutages, transformer])

  const lines = useMemo<MapLine[]>(() => {
    const byId = new globalThis.Map(availableStations.map((station) => [station.id, station] as const))
    const generationLines: MapLine[] = [
      {
        id: 'demo-tes-generator',
        name: 'ТЭС → Генератор · DEMO',
        kind: 'generation',
        status: scenarioOutages.has('demo-tes-generator') ? 'critical' : 'unknown',
        voltage: 'Генерация · DEMO',
        positions: [sourcePosition, generatorPosition],
        stationIds: [],
        fromId: 'source-tes-demo',
        toId: 'generator-demo',
        demo: true,
      },
      {
        id: 'demo-generator-transformer',
        name: 'Генератор → Повышающий трансформатор · DEMO',
        kind: 'generation',
        status: scenarioOutages.has('demo-generator-transformer') ? 'critical' : 'unknown',
        voltage: 'Генерация · DEMO',
        positions: [generatorPosition, stepUpPosition],
        stationIds: [],
        fromId: 'generator-demo',
        toId: 'step-up-transformer-demo',
        demo: true,
      },
    ]
    const sourceLine: MapLine = {
      id: 'demo-source-110',
      name: 'Магистраль ТЭС → ПС Северная · DEMO',
      kind: 'line',
      status: ['source-tes-demo', 'generator-demo', 'step-up-transformer-demo', 'demo-tes-generator', 'demo-generator-transformer', 'demo-source-110'].some((id) => scenarioOutages.has(id)) ? 'critical' : 'unknown',
      voltage: '110 кВ · условно',
      positions: [stepUpPosition, byId.get('north')?.position ?? cityCenter],
      stationIds: ['north'],
      fromId: 'step-up-transformer-demo',
      toId: 'north',
      demo: true,
    }
    const stationLines: MapLine[] = networkLines.map((line) => ({
      id: line.id,
      name: `${line.label} · DEMO-связь`,
      kind: 'line',
      status: scenarioOutages.has(line.id) ? 'critical' : line.status,
      voltage: line.id === 'line-07' ? '110 кВ · условно' : '6–10 кВ · условно',
      positions: [byId.get(line.from)?.position ?? cityCenter, byId.get(line.to)?.position ?? cityCenter],
      stationIds: [line.from, line.to],
      fromId: line.from,
      toId: line.to,
      demo: true,
    }))
    const feederLines: MapLine[] = []
    for (const station of availableStations) {
      for (let feederIndex = 0; feederIndex < 2; feederIndex += 1) {
        const tpId = `tp-demo-${station.id}-${feederIndex + 1}`
        const tpPosition = offsetPosition(station.position, feederIndex === 0 ? 1 : -1, feederIndex === 0 ? 1 : -1)
        feederLines.push({
          id: `feeder-demo-${station.id}-${feederIndex + 1}`,
          name: `Фидер ${station.id.toUpperCase()}-${feederIndex + 1} · DEMO`,
          kind: 'feeder',
          status: scenarioOutages.has(tpId) || !reachableStationIds.has(station.id)
            ? 'critical'
            : station.status,
          voltage: '6–10 кВ · условно',
          positions: [station.position, tpPosition],
          stationIds: [station.id],
          fromId: station.id,
          toId: tpId,
          demo: true,
        })
        for (let buildingIndex = 0; buildingIndex < 4; buildingIndex += 1) {
          const buildingPosition = offsetPosition(tpPosition, (buildingIndex % 2) * 0.6 - 0.3, Math.floor(buildingIndex / 2) * 0.6 - 0.3)
          feederLines.push({
            id: `drop-demo-${station.id}-${feederIndex + 1}-${buildingIndex + 1}`,
            name: `Ввод здания · DEMO`,
            kind: 'feeder',
            status: scenarioOutages.has(tpId) || scenarioOutages.has(`building-demo-${station.id}-${feederIndex + 1}-${buildingIndex + 1}`) || !reachableStationIds.has(station.id)
              ? 'critical'
              : station.status,
            voltage: '0,4 кВ · условно',
            positions: [tpPosition, buildingPosition],
            stationIds: [station.id],
            fromId: tpId,
            toId: `building-demo-${station.id}-${feederIndex + 1}-${buildingIndex + 1}`,
            demo: true,
          })
        }
      }
    }
    return [...generationLines, sourceLine, ...stationLines, ...feederLines]
  }, [availableStations, networkLines, scenarioOutages, transformer])

  const selectedObject = objects.find((object) => object.id === selectedId) ?? objects[0]
  const selectedLine = lines.find((line) => line.id === selectedId)
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId)
  const activeStationId = selectedCustomer
    ? ''
    : selectedObject?.kind === 'station'
      ? selectedObject.id
      : selectedObject?.stationId
        || selectedLine?.stationIds[0]
        || (scopeId !== 'all' && scopeId !== 'source-tes-demo' ? scopeId : availableStations[0]?.id)
        || ''
  const activeStation = availableStations.find((station) => station.id === activeStationId)
  const activeTransformers = objects.filter((object) => object.kind === 'tp' && object.stationId === activeStationId)
  const activeBuildings = objects.filter((object) => object.kind === 'building' && object.stationId === activeStationId)
  const selectedPathLineIds = useMemo(() => {
    const targetId = selectedCustomer
      ? undefined
      : selectedLine?.toId
        ?? (selectedObject?.kind === 'source'
          ? selectedObject.id === 'source-tes-demo'
            ? objects.find((object) => object.kind === 'building')?.id
            : selectedObject.id
          : selectedObject?.kind === 'station'
            ? objects.find((object) => object.kind === 'building' && object.stationId === selectedObject.id)?.id
            : selectedObject?.kind === 'tp'
              ? objects.find((object) => object.kind === 'building' && object.tpId === selectedObject.id)?.id
              : selectedObject?.id)
    const path = new Set<string>()
    const visited = new Set<string>()
    let nodeId = targetId
    while (nodeId && !visited.has(nodeId) && path.size < 30) {
      visited.add(nodeId)
      const parentLine = lines.find((line) => line.toId === nodeId)
      if (!parentLine) break
      path.add(parentLine.id)
      nodeId = parentLine.fromId
    }
    return path
  }, [lines, objects, selectedCustomer, selectedLine, selectedObject])
  const selectedPathNodeIds = useMemo(() => {
    const pathNodes = new Set<string>()
    for (const line of lines) {
      if (!selectedPathLineIds.has(line.id)) continue
      pathNodes.add(line.fromId)
      pathNodes.add(line.toId)
    }
    return pathNodes
  }, [lines, selectedPathLineIds])
  const selectedIncidents = incidents.filter((incident) =>
    incident.equipmentId === selectedObject?.id
    || incident.equipmentId === selectedObject?.stationId
    || incident.equipmentId === selectedLine?.id
    || Boolean(selectedLine?.stationIds.includes(incident.equipmentId)),
  )

  const scopedLines = lines.filter((line) => scopeId === 'all' || line.stationIds.includes(scopeId) || scopeId === 'source-tes-demo')
  const visibleObjects = objects.filter((object) => {
    const inScope = scopeId === 'all'
      || (scopeId === 'source-tes-demo' && (object.kind === 'source' || reachableStationIds.has(object.stationId)))
      || object.id === scopeId
      || object.stationId === scopeId
    const matchesKind = kindFilter === 'all'
      || object.kind === kindFilter
    const matchesVoltage = voltageFilter === 'all'
      || (voltageFilter === '110' && object.voltage.includes('110'))
      || (voltageFilter === '6-10' && object.voltage.includes('6–10'))
      || (voltageFilter === '0.4' && object.voltage.includes('0,4'))
    const hasIncident = incidents.some((incident) =>
      incident.equipmentId === object.id
      || incident.equipmentId === object.stationId,
    )
    return inScope
      && matchesKind
      && matchesVoltage
      && (statusFilter === 'all' || object.status === statusFilter)
      && (!incidentOnly || hasIncident || object.status === 'critical')
  })
  const visibleLines = scopedLines.filter((line) => {
    const matchesKind = kindFilter === 'all'
      || (kindFilter === 'line' && (line.kind === 'line' || line.kind === 'generation'))
      || (kindFilter === 'feeder' && line.kind === 'feeder')
    const matchesVoltage = voltageFilter === 'all'
      || (voltageFilter === '110' && line.voltage.includes('110'))
      || (voltageFilter === '6-10' && line.voltage.includes('6–10'))
      || (voltageFilter === '0.4' && line.voltage.includes('0,4'))
    const hasIncident = incidents.some((incident) => incident.equipmentId === line.id)
    return matchesKind
      && matchesVoltage
      && (statusFilter === 'all' || line.status === statusFilter)
      && (!incidentOnly || hasIncident || line.status === 'critical')
  })

  const searchResults = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('ru-RU')
    if (!term) return []
    const objectResults = objects
      .filter((object) => `${object.name} ${object.id} ${object.address ?? ''}`.toLocaleLowerCase('ru-RU').includes(term))
      .slice(0, 5)
      .map((object) => ({ id: object.id, label: object.address ? `${object.name} · ${object.address}` : object.name, kind: 'object' as const }))
    const customerResults = customers
      .filter((customer) => `${customer.address} ${customer.building} ${customer.id}`.toLocaleLowerCase('ru-RU').includes(term))
      .slice(0, 5)
      .map((customer) => ({ id: customer.id, label: `${customer.address} · ${customer.building} · ${customer.id}`, kind: 'customer' as const }))
    const lineResults = lines
      .filter((line) => `${line.name} ${line.id}`.toLocaleLowerCase('ru-RU').includes(term))
      .slice(0, 4)
      .map((line) => ({ id: line.id, label: line.name, kind: 'line' as const }))
    return [...objectResults, ...lineResults, ...customerResults].slice(0, 7)
  }, [customers, lines, objects, search])

  const outageCount = objects.filter((object) => object.kind === 'building' && object.status === 'critical').length
  const demoBuildings = objects.filter((object) => object.kind === 'building').length
  const selectedPosition = useMemo(() => selectedCustomer
    ? null
    : selectedLine
      ? [
        (selectedLine.positions[0][0] + selectedLine.positions[selectedLine.positions.length - 1][0]) / 2,
        (selectedLine.positions[0][1] + selectedLine.positions[selectedLine.positions.length - 1][1]) / 2,
      ] as LatLngTuple
      : selectedObject?.position ?? null, [selectedCustomer, selectedLine, selectedObject])
  const scenarioCanToggle = Boolean(selectedLine || selectedObject)
  const scenarioTargetId = selectedLine?.id ?? selectedObject?.id ?? ''
  const simulatedOff = scenarioOutages.has(scenarioTargetId)

  const chooseObject = (id: string) => {
    setSelectedId(id)
    setSelectedCustomerId('')
  }

  const chooseSearchResult = (result: (typeof searchResults)[number]) => {
    if (result.kind === 'customer') {
      setSelectedCustomerId(result.id)
      setScopeId('all')
    } else {
      chooseObject(result.id)
      const object = objects.find((item) => item.id === result.id)
      if (object?.stationId) setScopeId(object.stationId)
      const line = lines.find((item) => item.id === result.id)
      if (line?.stationIds[0]) setScopeId(line.stationIds[0])
    }
    setSearch(result.label)
    setSearchOpen(false)
  }

  const toggleScenarioOutage = () => {
    if (!scenarioTargetId) return
    setScenarioOutages((current) => {
      const next = new Set(current)
      if (next.has(scenarioTargetId)) next.delete(scenarioTargetId)
      else next.add(scenarioTargetId)
      return next
    })
  }

  return (
    <section className="network-map-screen" aria-label="Интерактивная схема электроснабжения">
      <div className="network-map-canvas">
        <MapContainer center={cityCenter} zoom={12} minZoom={10} maxZoom={18} zoomControl={false} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            className="network-map-tiles"
          />
          <ZoomControl position="bottomright" />
          <MapFocus position={selectedPosition} />
          {visibleLines.map((line) => {
            const color = lineColor(line)
            const isOnSelectedPath = selectedPathLineIds.has(line.id)
            return (
              <Fragment key={line.id}>
                <Polyline
                  positions={line.positions}
                  pathOptions={{
                    color,
                    weight: selectedId === line.id ? 6 : isOnSelectedPath ? 4.5 : line.kind === 'line' ? 3 : 2,
                    opacity: selectedCustomer ? 0.88 : selectedPathLineIds.size === 0 || isOnSelectedPath ? 0.95 : 0.4,
                    dashArray: line.status === 'critical' ? '7 7' : line.status === 'unknown' ? '3 6' : undefined,
                  }}
                  eventHandlers={{ click: () => { setSelectedId(line.id); setSelectedCustomerId('') } }}
                >
                  <Popup>
                    <strong>{line.name}</strong><br />
                    Направление: {nodeLabel(line.fromId, objects, stations)} → {nodeLabel(line.toId, objects, stations)}<br />
                    {line.voltage}<br />
                    {statusLabels[line.status]}
                  </Popup>
                </Polyline>
                <DirectionArrow positions={line.positions} color={color} />
              </Fragment>
            )
          })}
          {visibleObjects.map((object) => object.kind === 'building' ? (
            <Polygon
              key={object.id}
              positions={buildingPolygon(object.position)}
              pathOptions={{
                color: selectedPathNodeIds.has(object.id) ? '#f4f6dd' : statusColor[object.status],
                fillColor: statusColor[object.status],
                fillOpacity: selectedId === object.id ? 0.98 : selectedPathNodeIds.has(object.id) ? 0.9 : 0.72,
                weight: selectedId === object.id || selectedPathNodeIds.has(object.id) ? 2 : 1,
              }}
              eventHandlers={{ click: () => chooseObject(object.id) }}
            >
              <Popup>
                <strong>{object.name}</strong><br />
                {object.address}<br />
                {statusLabels[object.status]}
              </Popup>
            </Polygon>
          ) : (
            <CircleMarker
              key={object.id}
              center={object.position}
              radius={objectRadius(object.kind) + (selectedPathNodeIds.has(object.id) ? 2 : 0)}
              pathOptions={{
                color: selectedId === object.id || selectedPathNodeIds.has(object.id) ? '#f4f6dd' : statusColor[object.status],
                fillColor: object.kind === 'source' ? '#f49a32' : statusColor[object.status],
                fillOpacity: 0.94,
                weight: selectedId === object.id || selectedPathNodeIds.has(object.id) ? 3 : 2,
              }}
              eventHandlers={{ click: () => chooseObject(object.id) }}
            >
              <Popup>
                <strong>{object.name}</strong><br />
                {kindLabels[object.kind]}<br />
                {object.voltage}<br />
                {statusLabels[object.status]}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>

      <aside className="network-map-panel network-map-left">
        <div className="network-map-panel-title"><span><Zap size={15} />ЭНЕРГОСХЕМА</span><span className="demo-chip">DEMO</span></div>
        <div className="energy-chain">
          {[
            { id: 'source-tes-demo', icon: Factory, title: 'ТЭС Кокшетау', detail: 'Источник · DEMO' },
            { id: 'generator-demo', icon: Zap, title: 'Генератор', detail: 'Мощность не задана' },
            { id: 'step-up-transformer-demo', icon: Gauge, title: 'Повышающий трансформатор', detail: 'Условная ступень 110 кВ' },
          ].map(({ id, icon: Icon, title, detail }) => (
            <button key={id} className={`energy-chain-step ${selectedId === id ? 'selected' : ''}`} onClick={() => chooseObject(id)}>
              <span className={`energy-chain-icon ${id === 'step-up-transformer-demo' ? 'transformer-stage-icon' : 'generation-stage-icon'}`}><Icon size={16} /></span><span><strong>{title}</strong><small>{detail}</small></span><i>↓</i>
            </button>
          ))}
          <div className="energy-chain-divider"><span className="stage-voltage-110">МАГИСТРАЛЬ 110 кВ · DEMO</span></div>
          {stations.map((station) => (
            <button key={station.id} className={`energy-chain-step ${scopeId === station.id ? 'selected' : ''}`} onClick={() => { setScopeId(station.id); chooseObject(station.id) }}>
              <span className={`energy-chain-icon status-${station.status}`}><MapPin size={15} /></span>
              <span><strong>{station.name}</strong><small>{station.voltage} · {station.location}</small></span>
              <i>↓</i>
            </button>
          ))}
          <div className="energy-chain-divider"><span className="stage-voltage-low">СЕТЬ 6–10 кВ → ТП → ЗДАНИЯ · DEMO</span></div>
          <div className="network-map-source-select">
            <label htmlFor="network-source">Показать связанные объекты</label>
            <div className="source-select-wrap">
              <select id="network-source" value={scopeId} onChange={(event) => {
                const value = event.target.value
                setScopeId(value)
                if (value === 'all') chooseObject('source-tes-demo')
                else if (value !== 'source-tes-demo') chooseObject(value)
                else chooseObject(value)
              }}>
                <option value="all">Вся сеть</option>
                <option value="source-tes-demo">ТЭС · вся связанная сеть</option>
                {stations.map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
              </select><ChevronDown size={14} />
            </div>
          </div>
          <div className="network-customer-hierarchy">
            <div className="energy-chain-divider"><span>СЕТЬ 6–10 кВ · ПС {activeStation?.name ?? 'не выбрана'}</span></div>
            {activeTransformers.map((tp) => (
              <div className="network-hierarchy-branch" key={tp.id}>
                <button className={`network-hierarchy-node tp-node ${selectedId === tp.id ? 'selected' : ''}`} onClick={() => chooseObject(tp.id)}>
                        <span className="network-hierarchy-voltage">6–10 кВ</span><strong>{tp.name}</strong><i className={`network-hierarchy-dot status-${tp.status}`} />
                </button>
                <div className="network-hierarchy-drop">
                  <div className="energy-chain-divider"><span>ТП → ВВОД / СЧЁТЧИК → ЩИТ → КЛИЕНТ · DEMO</span></div>
                  {activeBuildings.filter((building) => building.tpId === tp.id).map((building) => (
                    <div className="network-building-branch" key={building.id}>
                      <button className={`network-hierarchy-node building-node ${selectedId === building.id ? 'selected' : ''}`} onClick={() => chooseObject(building.id)}>
                        <span className="network-hierarchy-voltage">0,4 кВ</span>
                        <span><strong>{building.name}</strong><small>{building.address}</small></span>
                        <i className={`network-hierarchy-dot status-${building.status}`} />
                      </button>
                      <div className="network-terminal-chain"><span>ВВОД</span><b>→</b><span>СЧЁТЧИК</span><b>→</b><span>ЩИТ</span><b>→</b><span>КЛИЕНТ · DEMO</span></div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {activeTransformers.length === 0 && <span className="network-hierarchy-empty">Нет ТП для выбранной подстанции</span>}
            <div className="network-customer-records">
              <strong>РЕЕСТР КЛИЕНТОВ · БЕЗ КООРДИНАТ</strong>
              {customers.slice(0, 3).map((customer) => (
                <button key={customer.id} onClick={() => { setSelectedCustomerId(customer.id); setSearchOpen(false) }}>
                  <span>{customer.address} · {customer.building}</span><small>{customer.id} · на карте не привязан</small>
                </button>
              ))}
              {customers.length === 0 && <small>Клиенты пока не загружены из API</small>}
            </div>
          </div>
        </div>
        <p className="network-demo-warning"><AlertTriangle size={13} />Схема и размещение DEMO; не использовать для оперативных решений.</p>
      </aside>

      <aside className="network-map-panel network-map-right">
        <div className="network-map-panel-title"><span><ShieldAlert size={15} />СЛОИ И ФИЛЬТРЫ</span><button className="network-clear-filters" onClick={() => { setKindFilter('all'); setVoltageFilter('all'); setStatusFilter('all'); setIncidentOnly(false) }}>Сбросить</button></div>
        <label className="network-filter-label">Тип объекта<select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="all">Все объекты</option><option value="source">Источники</option><option value="station">Подстанции</option><option value="transformer">Трансформаторы</option><option value="line">Линии</option><option value="tp">ТП</option><option value="building">Здания</option></select></label>
        <label className="network-filter-label">Напряжение<select value={voltageFilter} onChange={(event) => setVoltageFilter(event.target.value)}><option value="all">Все уровни</option><option value="110">110 кВ</option><option value="6-10">6–10 кВ</option><option value="0.4">0,4 кВ</option></select></label>
        <label className="network-filter-label">Состояние<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Все состояния</option><option value="normal">Норма</option><option value="warning">Нестабильно</option><option value="critical">Авария / нет питания</option><option value="unknown">Нет данных</option></select></label>
        <label className="network-incident-toggle"><input type="checkbox" checked={incidentOnly} onChange={(event) => setIncidentOnly(event.target.checked)} />Только аварии и критические узлы</label>

        <div className="network-map-legend">
          <span><i className="legend-line voltage-generation" />Генерация · DEMO</span>
          <span><i className="legend-line voltage-110" />110 кВ · DEMO</span>
          <span><i className="legend-line voltage-low" />6–10 кВ · DEMO</span>
          <span><i className="legend-line voltage-service" />0,4 кВ · DEMO</span>
          <span><i className="legend-status normal" />Питание в норме</span>
          <span><i className="legend-status warning" />Нестабильно</span>
          <span><i className="legend-status critical" />Нет питания</span>
          <span><i className="legend-status unknown" />Нет данных</span>
        </div>
        <div className="network-direction-hint"><span>➤</span>Стрелка показывает направление к потребителю</div>

        <div className="network-object-detail">
          <div className="network-object-detail-kicker">ВЫБРАННЫЙ ОБЪЕКТ</div>
          {selectedCustomer ? (
            <>
              <strong>{selectedCustomer.address}</strong>
              <span>{selectedCustomer.building} · клиент {selectedCustomer.id}</span>
              <span>Учётный статус: {selectedCustomer.supplyStatus === 'connected' ? 'подключён' : selectedCustomer.supplyStatus === 'disconnected' ? 'отключён' : 'не подтверждён'}</span>
              <small>Координаты клиента не загружены — объект не нанесён на карту.</small>
            </>
          ) : selectedLine ? (
            <>
              <strong>{selectedLine.name}</strong>
              <span>{kindLabels[selectedLine.kind]} · ID {selectedLine.id}</span>
              <span>Напряжение: {selectedLine.voltage}</span>
              <span>Связанные ПС: {selectedLine.stationIds.map((id) => stations.find((station) => station.id === id)?.name ?? id).join(' → ')}</span>
              <span className={`network-object-status status-${selectedLine.status}`}><i />{statusLabels[selectedLine.status]}</span>
              <div className="network-object-events">
                <strong>История аварий</strong>
                {selectedIncidents.length
                  ? selectedIncidents.slice(0, 3).map((incident) => <span key={incident.id}>{incident.time} · {incident.title}</span>)
                  : <small>Связанных записей в журнале нет</small>}
              </div>
              {scenarioCanToggle && (
                <button className={`network-scenario-button ${simulatedOff ? 'restore' : ''}`} onClick={toggleScenarioOutage}>
                  {simulatedOff ? <Zap size={13} /> : <AlertTriangle size={13} />}
                  {simulatedOff ? 'Восстановить в DEMO-сценарии' : 'Смоделировать отключение'}
                </button>
              )}
            </>
          ) : selectedObject ? (
            <>
              <strong>{selectedObject.name}</strong>
              <span>{kindLabels[selectedObject.kind]} · ID {selectedObject.id}</span>
              {selectedObject.address && <span>{selectedObject.address}</span>}
              <span>Источник: ТЭС · DEMO</span>
              {selectedObject.stationId && <span>Питающая ПС: {stations.find((station) => station.id === selectedObject.stationId)?.name ?? selectedObject.stationId}</span>}
              {selectedObject.tpId && <span>Связана с: {objects.find((object) => object.id === selectedObject.tpId)?.name ?? selectedObject.tpId}</span>}
              <span>Напряжение: {selectedObject.voltage}</span>
              {selectedObject.load !== undefined && <span>Нагрузка из БД: {selectedObject.load}%</span>}
              <span className={`network-object-status status-${selectedObject.status}`}><i />{statusLabels[selectedObject.status]}</span>
              <div className="network-object-events">
                <strong>История аварий</strong>
                {selectedIncidents.length
                  ? selectedIncidents.slice(0, 3).map((incident) => <span key={incident.id}>{incident.time} · {incident.title}</span>)
                  : <small>Связанных записей в журнале нет</small>}
              </div>
              {scenarioCanToggle && (
                <button className={`network-scenario-button ${simulatedOff ? 'restore' : ''}`} onClick={toggleScenarioOutage}>
                  {simulatedOff ? <Zap size={13} /> : <AlertTriangle size={13} />}
                  {simulatedOff ? 'Восстановить в DEMO-сценарии' : 'Смоделировать отключение'}
                </button>
              )}
            </>
          ) : <span>Выберите объект на карте</span>}
        </div>
        {scenarioOutages.size > 0 && <div className="network-scenario-note"><CircleHelp size={13} />Активен локальный DEMO-сценарий. Состояние в БД и реальном оборудовании не меняется.</div>}
        <div className="network-route-summary">
          <div className="network-route-summary-title"><Zap size={13} />НАПРАВЛЕНИЕ ПИТАНИЯ · DEMO</div>
          {selectedCustomer
            ? <p>Клиент найден в реестре, но в базе нет координат и связи с конкретной ТП. Маршрут до этого клиента не отображается, чтобы не выдумывать подключение.</p>
            : selectedPathLineIds.size > 0
              ? <>
                {lines.filter((line) => selectedPathLineIds.has(line.id)).map((line, index) => {
                  const from = objects.find((object) => object.id === line.fromId)?.name
                    ?? stations.find((station) => station.id === line.fromId)?.name
                    ?? line.fromId
                  const to = objects.find((object) => object.id === line.toId)?.name
                    ?? stations.find((station) => station.id === line.toId)?.name
                    ?? line.toId
                  return <div className="network-route-step" key={line.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <i style={{ backgroundColor: lineColor(line) }} />
                    <strong>{from}</strong><b>→</b><strong>{to}</strong>
                    <small>{line.voltage}</small>
                  </div>
                })}
                <p>Конечные «клиентские» точки — условные DEMO-здания. Для фактического маршрута нужны официальные связи и координаты.</p>
              </>
              : <p>Выберите ПС, линию, ТП или DEMO-здание, чтобы увидеть направление.</p>}
        </div>
      </aside>

      <div className="network-map-bottom">
        <div className="network-map-stats">
          <span><Building2 size={16} /><strong>{customers.length}</strong><small>клиентов в реестре</small></span>
          <span><MapPin size={16} /><strong>{objects.filter((object) => object.kind === 'tp').length}</strong><small>ТП · DEMO</small></span>
          <span><Cable size={16} /><strong>{demoBuildings}</strong><small>зданий · DEMO</small></span>
          <span className={outageCount > 0 ? 'has-outages' : ''}><AlertTriangle size={16} /><strong>{outageCount}</strong><small>без питания · расчёт DEMO</small></span>
          <span><ShieldAlert size={16} /><strong>{incidents.filter((incident) => !incident.acknowledged).length}</strong><small>активных событий из БД</small></span>
        </div>
        <div className="network-address-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && searchResults[0]) chooseSearchResult(searchResults[0])
              if (event.key === 'Escape') setSearchOpen(false)
            }}
            placeholder="Поиск по адресу, ID или объекту…"
            aria-label="Поиск по адресу, ID или объекту"
          />
          {search && <button aria-label="Очистить поиск" onClick={() => { setSearch(''); setSelectedCustomerId(''); setSearchOpen(false) }}>×</button>}
          {searchOpen && search.trim() && <div className="network-search-results">
            {searchResults.map((result) => <button key={`${result.kind}-${result.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSearchResult(result)}>
              <span>{result.label}</span><small>{result.kind === 'customer' ? 'Нет координат' : 'DEMO-карта'}</small>
            </button>)}
            {searchResults.length === 0 && <span className="network-search-empty">Совпадений нет</span>}
          </div>}
        </div>
      </div>
      <div className="network-map-demo-stamp"><span className="live-dot" />СЛОЙ OSM · ГЕОДАННЫЕ ЭЛЕКТРОСЕТИ DEMO / НЕ ФАКТИЧЕСКИЕ</div>
    </section>
  )
}
