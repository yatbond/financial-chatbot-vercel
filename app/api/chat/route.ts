import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

// Acronym mapping (same as Streamlit app)
const ACRONYM_MAP: Record<string, string> = {
  'gp': 'gross profit',
  'np': 'net profit',
  'subcon': 'subcontractor',
  'projected': 'projection',
  'rebar': 'reinforcement',
  'staff': 'manpower (mgt. & supervision)',
  'labour': 'manpower (labour)',
  'labor': 'manpower (labour)',
  'cashflow': 'cash flow',
  'cash': 'cash flow',
  'prelim': 'preliminaries',
  'preliminary': 'preliminaries',
  'material': 'materials',
  'plant': 'plant and machinery',
  'machinery': 'plant and machinery',
  'lab': 'labour',
  'manpower': 'manpower (labour) for works',
}

function expandAcronyms(text: string): string {
  const words = text.toLowerCase().split(/\s+/)
  return words.map(word => ACRONYM_MAP[word] || word).join(' ')
}

interface FinancialRow {
  Year: string
  Month: string
  Sheet_Name: string
  Financial_Type: string
  Data_Type: string
  Item_Code: string
  Value: number
  _project?: string
}

interface ProjectInfo {
  code: string
  name: string
  year: string
  month: string
  filename: string
  fileId?: string
}

interface FolderStructure {
  [year: string]: string[]
}

// Google Drive helper functions
async function getDriveService() {
  // For Vercel: use environment variable
  const credentials = process.env.GOOGLE_CREDENTIALS
  if (!credentials) {
    throw new Error('GOOGLE_CREDENTIALS not set')
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  })

  return google.drive({ version: 'v3', auth })
}

async function findRootFolder(drive: any) {
  const res = await drive.files.list({
    q: "name='Ai Chatbot Knowledge Base' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id, name)'
  })

  return res.data.files?.[0] || null
}

async function listYearFolders(drive: any, rootId: string) {
  const allFiles: any[] = []
  let pageToken: string | null = null
  
  do {
    const res = await drive.files.list({
      q: `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name), nextPageToken',
      pageSize: 100,
      pageToken: pageToken || undefined
    })
    if (res.data.files) allFiles.push(...res.data.files)
    pageToken = res.data.nextPageToken || null
  } while (pageToken)
  
  return allFiles
}

async function listMonthFolders(drive: any, yearId: string) {
  const allFiles: any[] = []
  let pageToken: string | null = null
  
  do {
    const res = await drive.files.list({
      q: `'${yearId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name), nextPageToken',
      pageSize: 100,
      pageToken: pageToken || undefined
    })
    if (res.data.files) allFiles.push(...res.data.files)
    pageToken = res.data.nextPageToken || null
  } while (pageToken)
  
  return allFiles
}

async function listCsvFiles(drive: any, monthId: string) {
  const allFiles: any[] = []
  let pageToken: string | null = null
  
  do {
    const res = await drive.files.list({
      q: `'${monthId}' in parents and name contains '_flat.csv' and trashed=false`,
      fields: 'files(id, name), nextPageToken',
      pageSize: 100,
      pageToken: pageToken || undefined
    })
    if (res.data.files) allFiles.push(...res.data.files)
    pageToken = res.data.nextPageToken || null
  } while (pageToken)
  
  return allFiles
}

// Extract project code and name from filename
function extractProjectInfo(filename: string): { code: string | null; name: string } {
  const name = filename.replace('_flat.csv', '')
  const match = name.match(/^(\d+)/)
  if (match) {
    const code = match[1]
    const projectName = name.slice(code.length).trim()
    const cleanName = projectName.replace(/\s*Financial\s*Report.*/i, '').trim()
    return { code, name: cleanName }
  }
  return { code: null, name }
}

// Get folder structure from Google Drive
async function getFolderStructure(): Promise<{ folders: FolderStructure; projects: Record<string, ProjectInfo>; error?: string }> {
  const folders: FolderStructure = {}
  const projects: Record<string, ProjectInfo> = {}

  try {
    const drive = await getDriveService()
    const rootFolder = await findRootFolder(drive)

    if (!rootFolder) {
      return { folders, projects, error: 'Folder "Ai Chatbot Knowledge Base" not found' }
    }

    const yearFolders = await listYearFolders(drive, rootFolder.id!)

    for (const yearFolder of yearFolders) {
      const year = yearFolder.name!
      const monthFolders = await listMonthFolders(drive, yearFolder.id!)

      for (const monthFolder of monthFolders) {
        const csvFiles = await listCsvFiles(drive, monthFolder.id!)

        if (csvFiles.length > 0) {
          if (!folders[year]) folders[year] = []
          if (!folders[year].includes(monthFolder.name!)) folders[year].push(monthFolder.name!)

          for (const file of csvFiles) {
            const { code, name } = extractProjectInfo(file.name!)
            if (code) {
              projects[file.name!] = {
                code,
                name,
                year,
                month: monthFolder.name!,
                filename: file.name!,
                fileId: file.id!
              }
            }
          }
        }
      }
    }
  } catch (error: any) {
    console.error('Error getting folder structure:', error)
    return { folders, projects, error: error.message || 'Unknown error' }
  }

  return { folders, projects }
}

// Load a single project CSV from Google Drive
async function loadProjectData(filename: string, year: string, month: string): Promise<FinancialRow[]> {
  try {
    const drive = await getDriveService()
    const rootFolder = await findRootFolder(drive)
    if (!rootFolder) return []

    const yearFolders = await listYearFolders(drive, rootFolder.id!)
    const yearFolder = yearFolders.find(f => f.name === year)
    if (!yearFolder) return []

    const monthFolders = await listMonthFolders(drive, yearFolder.id!)
    const monthFolder = monthFolders.find(f => f.name === month)
    if (!monthFolder) return []

    const csvFiles = await listCsvFiles(drive, monthFolder.id!)
    const targetFile = csvFiles.find(f => f.name === filename)
    if (!targetFile) return []

    // Download file
    const res = await drive.files.get({
      fileId: targetFile.id!,
      alt: 'media'
    }, { responseType: 'text' })

    // Parse CSV properly using headers
    const lines = (res.data as string).split('\n')
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
    
    // Find column indices from header
    const colMap: Record<string, number> = {}
    headers.forEach((h, i) => {
      const lower = h.toLowerCase()
      if (lower === 'sheet_name' || lower === 'sheet') colMap.sheet = i
      else if (lower === 'financial_type' || lower === 'type') colMap.financialType = i
      else if (lower === 'data_type' || lower === 'data') colMap.dataType = i
      else if (lower === 'item_code' || lower === 'code') colMap.itemCode = i
      else if (lower === 'value' || lower === 'amount') colMap.value = i
    })
    
    console.log('CSV Headers:', headers)
    console.log('Column mapping:', colMap)
    
    const { name } = extractProjectInfo(filename)
    const code = filename.match(/^(\d+)/)?.[1] || ''
    const projectLabel = `${code} - ${name}`

    const data: FinancialRow[] = []
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue
      
      // Handle quoted CSV values
      const values: string[] = []
      let inQuote = false
      let current = ''
      for (let j = 0; j < lines[i].length; j++) {
        const char = lines[i][j]
        if (char === '"') {
          inQuote = !inQuote
        } else if (char === ',' && !inQuote) {
          values.push(current.trim().replace(/"/g, ''))
          current = ''
        } else {
          current += char
        }
      }
      values.push(current.trim().replace(/"/g, ''))
      
      const valueIndex = colMap.value ?? 4
      const value = parseFloat(values[valueIndex]) || 0
      
      const row: FinancialRow = {
        Year: year,
        Month: month,
        Sheet_Name: values[colMap.sheet ?? 0] || '',
        Financial_Type: values[colMap.financialType ?? 1] || '',
        Data_Type: values[colMap.dataType ?? 2] || '',
        Item_Code: values[colMap.itemCode ?? 3] || '',
        Value: value,
        _project: projectLabel
      }
      data.push(row)
    }
    
    console.log(`Parsed ${data.length} rows, sample:`, data.slice(0, 3))
    return data
  } catch (error) {
    console.error('Error loading project data:', error)
    return []
  }
}

// Calculate project metrics
function getProjectMetrics(data: FinancialRow[], project: string) {
  const projectData = data.filter(d => d._project === project)
  if (projectData.length === 0) return { 'Business Plan GP': 0, 'Projected GP': 0, 'WIP GP': 0, 'Cash Flow': 0 }

  const gpFilter = (d: FinancialRow) => d.Item_Code === '3' && d.Data_Type?.toLowerCase().includes('gross profit')

  const bp = projectData.filter(d =>
    d.Sheet_Name === 'Financial Status' &&
    d.Financial_Type?.toLowerCase().includes('business plan') &&
    gpFilter(d)
  ).reduce((sum, d) => sum + d.Value, 0)

  const proj = projectData.filter(d =>
    d.Sheet_Name === 'Financial Status' &&
    d.Financial_Type?.toLowerCase().includes('projection') &&
    gpFilter(d)
  ).reduce((sum, d) => sum + d.Value, 0)

  const wip = projectData.filter(d =>
    d.Sheet_Name === 'Financial Status' &&
    d.Financial_Type?.toLowerCase().includes('audit report') &&
    gpFilter(d)
  ).reduce((sum, d) => sum + d.Value, 0)

  const cf = projectData.filter(d =>
    d.Sheet_Name === 'Financial Status' &&
    d.Financial_Type?.toLowerCase().includes('cash flow') &&
    gpFilter(d)
  ).reduce((sum, d) => sum + d.Value, 0)

  return { 'Business Plan GP': bp, 'Projected GP': proj, 'WIP GP': wip, 'Cash Flow': cf }
}

// Handle monthly category queries
function handleMonthlyCategory(data: FinancialRow[], project: string, question: string, month: string): string {
  const expandedQuestion = expandAcronyms(question).toLowerCase()

  const categoryMap: Record<string, string> = {
    'plant and machinery': '2.3',
    'preliminaries': '2.1',
    'materials': '2.2',
    'plant': '2.3',
    'machinery': '2.3',
    'labour': '2.4',
    'labor': '2.4',
    'manpower (labour) for works': '2.5',
    'manpower (labour)': '2.5',
    'manpower': '2.5',
    'subcontractor': '2.5',
    'subcon': '2.5',
    'staff': '2.6',
    'admin': '2.7',
    'administration': '2.7',
    'insurance': '2.8',
    'bond': '2.9',
    'others': '2.10',
    'other': '2.10',
    'contingency': '2.11',
  }

  if (!expandedQuestion.includes('monthly')) return ''

  let categoryPrefix = ''
  let categoryName = ''

  const sortedCategories = Object.entries(categoryMap).sort((a, b) => b[0].length - a[0].length)
  for (const [kw, prefix] of sortedCategories) {
    const pattern = new RegExp(`\\b${kw}\\b`, 'i')
    if (pattern.test(expandedQuestion)) {
      categoryPrefix = prefix
      categoryName = kw
      break
    }
  }

  if (!categoryPrefix) return ''

  const projectData = data.filter(d => d._project === project)

  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

  let targetMonth = parseInt(month)
  for (let i = 0; i < monthNames.length; i++) {
    if (expandedQuestion.includes(monthNames[i]) || expandedQuestion.includes(monthAbbr[i])) {
      targetMonth = i + 1
      break
    }
  }

  const financialTypes = ['Projection', 'Committed Cost', 'Accrual', 'Cash Flow']
  const results: Record<string, number> = {}

  for (const ft of financialTypes) {
    const filtered = projectData.filter(d =>
      d.Sheet_Name === ft &&
      d.Month === String(targetMonth) &&
      (d.Item_Code.startsWith(categoryPrefix + '.') || d.Item_Code === categoryPrefix)
    )
    results[ft] = filtered.reduce((sum, d) => sum + d.Value, 0)
  }

  const displayName = categoryName.charAt(0).toUpperCase() + categoryName.slice(1)
  let response = `## Monthly ${displayName} (${targetMonth}/${month}) ('000)\n\n`

  for (const [ft, value] of Object.entries(results)) {
    response += `- **${ft}:** $${value.toLocaleString()}\n`
  }

  return response
}

// Natural language query handler
function answerQuestion(data: FinancialRow[], project: string, question: string, month: string): string {
  const expandedQuestion = expandAcronyms(question).toLowerCase()

  const monthlyResult = handleMonthlyCategory(data, project, question, month)
  if (monthlyResult) return monthlyResult

  const projectData = data.filter(d => d._project === project)
  if (projectData.length === 0) return 'No data found for this project.'

  const targetMonth = parseInt(month)

  const isGrossProfit = /gross\s*profit|gp|wip/i.test(expandedQuestion)
  const isNetProfit = /net\s*profit|np/i.test(expandedQuestion)
  const isBudget = /business\s*plan|budget/i.test(expandedQuestion)
  const isProjection = /projection|projected/i.test(expandedQuestion)
  const isAudit = /audit|wip/i.test(expandedQuestion)
  const isCashFlow = /cash\s*flow|cash/i.test(expandedQuestion)

  let financialType = ''
  if (isCashFlow) financialType = 'Cash Flow'
  else if (isAudit) financialType = 'Audit Report (WIP) J'
  else if (isBudget) financialType = 'Business Plan'
  else if (isProjection) financialType = 'Projection'

  let itemCode = ''
  if (isNetProfit) itemCode = '7'
  else if (isGrossProfit) itemCode = '3'

  let filtered = projectData

  if (financialType) {
    filtered = filtered.filter(d => d.Financial_Type?.toLowerCase().includes(financialType.toLowerCase()))
  }

  if (itemCode) {
    filtered = filtered.filter(d => d.Item_Code === itemCode)
  }

  filtered = filtered.filter(d => d.Month === String(targetMonth))

  if (filtered.length === 0) {
    return `No data found for "${question}" in month ${targetMonth}.`
  }

  const total = filtered.reduce((sum, d) => sum + d.Value, 0)
  const first = filtered[0]

  return `## $${total.toLocaleString()} ('000)

**Year:** ${first.Year}
**Month:** ${first.Month}
**Sheet:** ${first.Sheet_Name}
**Financial Type:** ${first.Financial_Type}
**Item Code:** ${first.Item_Code}
**Data Type:** ${first.Data_Type}

*Records found: ${filtered.length}*`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, year, month, project, projectFile, question } = body

    switch (action) {
      case 'getStructure': {
        const result = await getFolderStructure()
        if (result.error) {
          return NextResponse.json({ 
            folders: result.folders, 
            projects: result.projects,
            error: result.error 
          })
        }
        return NextResponse.json({ 
          folders: result.folders, 
          projects: result.projects 
        })
      }

      case 'loadProject': {
        const data = await loadProjectData(projectFile, year, month)
        const metrics = getProjectMetrics(data, project)
        return NextResponse.json({ data, metrics })
      }

      case 'query': {
        const data = await loadProjectData(projectFile, year, month)
        const response = answerQuestion(data, project, question, month)
        return NextResponse.json({ response })
      }

      case 'metrics': {
        const data = await loadProjectData(projectFile, year, month)
        const metrics = getProjectMetrics(data, project)
        return NextResponse.json({ metrics })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
