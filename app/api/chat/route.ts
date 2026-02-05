import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import Papa from 'papaparse'

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
  return words.map(word => {
    // Check if word is a key in acronym map
    if (ACRONYM_MAP[word]) return ACRONYM_MAP[word]
    return word
  }).join(' ')
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
}

interface FolderStructure {
  [year: string]: string[]
}

interface ProjectMetrics {
  'Business Plan GP': number
  'Projected GP': number
  'WIP GP': number
  'Cash Flow': number
}

const DATA_DIR = 'G:/My Drive/Ai Chatbot Knowledge Base'

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

// Get folder structure (fast - no data loading)
function getFolderStructure(): { folders: FolderStructure; projects: Record<string, ProjectInfo> } {
  const folders: FolderStructure = {}
  const projects: Record<string, ProjectInfo> = {}

  if (!fs.existsSync(DATA_DIR)) {
    return { folders, projects }
  }

  const years = fs.readdirSync(DATA_DIR).filter(f => {
    const fullPath = path.join(DATA_DIR, f)
    return fs.statSync(fullPath).isDirectory()
  })

  for (const year of years) {
    const yearPath = path.join(DATA_DIR, year)
    const months = fs.readdirSync(yearPath)

    for (const month of months) {
      const monthPath = path.join(yearPath, month)
      const files = fs.readdirSync(monthPath).filter(f => f.endsWith('_flat.csv'))

      if (files.length > 0) {
        if (!folders[year]) folders[year] = []
        if (!folders[year].includes(month)) folders[year].push(month)

        for (const file of files) {
          const { code, name } = extractProjectInfo(file)
          if (code) {
            projects[file] = { code, name, year, month, filename: file }
          }
        }
      }
    }
  }

  return { folders, projects }
}

// Load a single project CSV
function loadProjectData(filename: string, year: string, month: string): FinancialRow[] {
  const filePath = path.join(DATA_DIR, year, month, filename)

  if (!fs.existsSync(filePath)) return []

  const content = fs.readFileSync(filePath, 'utf-8')
  const parsed = Papa.parse<FinancialRow>(content, { header: true, skipEmptyLines: true })

  const { name } = extractProjectInfo(filename)
  const code = filename.match(/^(\d+)/)?.[1] || ''
  const projectLabel = `${code} - ${name}`

  return parsed.data.map(row => ({
    ...row,
    Year: year,
    Month: month,
    Value: parseFloat(row.Value as unknown as string) || 0,
    _project: projectLabel
  }))
}

// Calculate project metrics
function getProjectMetrics(data: FinancialRow[], project: string): ProjectMetrics {
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

  // Check if monthly query
  if (!expandedQuestion.includes('monthly')) return ''

  let categoryPrefix = ''
  let categoryName = ''

  // Find category (longer phrases first)
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

  // Find target month
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

  let targetMonth = parseInt(month)
  for (let i = 0; i < monthNames.length; i++) {
    if (expandedQuestion.includes(monthNames[i]) || expandedQuestion.includes(monthAbbr[i])) {
      targetMonth = i + 1
      break
    }
  }

  // Get data
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

  // Format response
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

  // Check monthly category first
  const monthlyResult = handleMonthlyCategory(data, project, question, month)
  if (monthlyResult) return monthlyResult

  const projectData = data.filter(d => d._project === project)
  if (projectData.length === 0) return 'No data found for this project.'

  const targetMonth = parseInt(month)

  // Detect intent
  const isGrossProfit = /gross\s*profit|gp|wip/i.test(expandedQuestion)
  const isNetProfit = /net\s*profit|np/i.test(expandedQuestion)
  const isBudget = /business\s*plan|budget/i.test(expandedQuestion)
  const isProjection = /projection|projected/i.test(expandedQuestion)
  const isAudit = /audit|wip/i.test(expandedQuestion)
  const isCashFlow = /cash\s*flow|cash/i.test(expandedQuestion)

  // Determine financial type
  let financialType = ''
  if (isCashFlow) financialType = 'Cash Flow'
  else if (isAudit) financialType = 'Audit Report (WIP) J'
  else if (isBudget) financialType = 'Business Plan'
  else if (isProjection) financialType = 'Projection'

  // Determine item code
  let itemCode = ''
  if (isNetProfit) itemCode = '7'
  else if (isGrossProfit) itemCode = '3'

  // Find matching data
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
        const { folders, projects } = getFolderStructure()
        return NextResponse.json({ folders, projects })
      }

      case 'loadProject': {
        const data = loadProjectData(projectFile, year, month)
        const metrics = getProjectMetrics(data, project)
        return NextResponse.json({ data, metrics })
      }

      case 'query': {
        const data = loadProjectData(projectFile, year, month)
        const response = answerQuestion(data, project, question, month)
        return NextResponse.json({ response })
      }

      case 'metrics': {
        const data = loadProjectData(projectFile, year, month)
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
