const apiUrl = process.env.API_URL ?? 'http://localhost:3000/api/v1/telemetry'
const accessToken = process.env.SIMULATOR_TOKEN
const equipmentIds = ['transformer-west-2', 'line-14']

async function publishDemoSample() {
  const equipmentId = equipmentIds[Math.floor(Math.random() * equipmentIds.length)]
  const nominalVoltage = equipmentId === 'transformer-west-2' ? 35 : 110
  const sample = {
    equipmentId,
    voltage: Number((nominalVoltage * (0.98 + Math.random() * 0.04)).toFixed(2)),
    current: Number((180 + Math.random() * 80).toFixed(2)),
    activePower: Number((45 + Math.random() * 35).toFixed(2)),
    frequency: Number((49.95 + Math.random() * 0.1).toFixed(3)),
    measuredAt: new Date().toISOString(),
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(sample),
    })
    if (!response.ok) console.error(`Telemetry API returned ${response.status}`)
    else console.info(`Published demo sample for ${sample.equipmentId}`)
  } catch (error) {
    console.error('Could not publish demo telemetry', error)
  }
}

console.info(`Demo telemetry simulator -> ${apiUrl}`)
void publishDemoSample()
setInterval(() => void publishDemoSample(), Number(process.env.INTERVAL_MS ?? 5000))