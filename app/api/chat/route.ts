import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

// Acronym mapping (same as Streamlit app)
const ACRONYM_MAP: Record<string, string> = {
  'gp': 'gross profit',
  'np': 'net profit',
  'wip': 'audit report (wip)',
  'subcon': 'subcontractor',
  'sub': 'subcontractor',
  'subcontractor': 'subcontractor',
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
}

function expandAcronyms(text: string): string {
  const words = text.toLowerCase().split(/\s+/)
  return words.map(word => ACRONYM_MAP[word] || word).join(' ')
}

// Helper to convert Value to number safely
function toNumber(val: number | string): number {
  if (typeof val === 'number') return val
  return parseFloat(val) || 0
}

interface FinancialRow {
  Year: string
  Month: string
  Sheet_Name: string
  Financial_Type: string
  Data_Type: string
  Item_Code: string
  Value: number | string
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

    // Parse CSV - columns are at fixed positions:
    // 0: Year, 1: Month, 2: Sheet_Name, 3: Financial_Type, 4: Item_Code, 5: Data_Type, 6: Value
    const lines = (res.data as string).split('\n').filter(line => line.trim())
    
    const { name } = extractProjectInfo(filename)
    const code = filename.match(/^(\d+)/)?.[1] || ''
    const projectLabel = `${code} - ${name}`

    const data: FinancialRow[] = []
    for (let i = 0; i < lines.length; i++) {
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
      
      // Skip header row if present
      const firstValue = values[0]?.toLowerCase()
      if (i === 0 && (firstValue === 'year' || firstValue === 'sheet_name')) continue
      
      // Parse each column - columns are at fixed positions:
      // 0: Year, 1: Month, 2: Sheet_Name, 3: Financial_Type, 4: Item_Code, 5: Data_Type, 6: Value
      
      // Extract Data_Type directly from column 5 (not pattern matching)
      const dataType = values[5] || ''
      
      // Extract Item_Code from column 4
      const itemCode = values[4] || ''
      
      // Financial_Type from column 3
      const financialType = values[3] || ''
      
      // For Project Info (Financial_Type = "General"), keep values as strings (dates, percentages)
      // For financial data, parse as numbers
      const rawValue = values[values.length - 1] || ''
      let value: number | string
      
      if (financialType === 'General') {
        // Keep Project Info values as strings
        value = rawValue
      } else {
        // Parse financial values as numbers
        value = parseFloat(rawValue) || 0
      }
      
      const row: FinancialRow = {
        Year: values[0] || '',
        Month: values[1] || '',
        Sheet_Name: values[2] || '',
        Financial_Type: financialType,
        Data_Type: dataType || '',
        Item_Code: itemCode,
        Value: value,
        _project: projectLabel
      }
      data.push(row)
    }
    return data
  } catch (error) {
    console.error('Error loading project data:', error)
    return []
  }
}

// Calculate project metrics
function getProjectMetrics(data: FinancialRow[], project: string) {
  const projectData = data.filter(d => d._project === project)
  if (projectData.length === 0) {
    return {
      'Business Plan GP': 0,
      'Projected GP': 0,
      'WIP GP': 0,
      'Cash Flow': 0,
      'Start Date': 'N/A',
      'Complete Date': 'N/A',
      'Target Complete Date': 'N/A',
      'Time Consumed (%)': 'N/A',
      'Target Completed (%)': 'N/A'
    }
  }

  const gpFilter = (d: FinancialRow) => d.Item_Code === '3' && d.Data_Type?.toLowerCase().includes('gross profit')

  // Helper to convert Value to number safely
  const toNumber = (val: number | string): number => {
    if (typeof val === 'number') return val
    return parseFloat(val) || 0
  }

  const bp = projectData.filter(d =>
    d.Sheet_Name === 'Financial Status' &&
    d.Financial_Type?.toLowerCase().includes('business plan') &&
    gpFilter(d)
  ).reduce((sum, d) => sum + toNumber(d.Value), 0)

  const proj = projectData.filter(d =>
    d.Sheet_Name === 'Financial Status' &&
    d.Financial_Type?.toLowerCase().includes('projection') &&
    gpFilter(d)
  ).reduce((sum, d) => sum + toNumber(d.Value), 0)

  const wip = projectData.filter(d =>
    d.Sheet_Name === 'Financial Status' &&
    d.Financial_Type?.toLowerCase().includes('audit report') &&
    gpFilter(d)
  ).reduce((sum, d) => sum + toNumber(d.Value), 0)

  const cf = projectData.filter(d =>
    d.Sheet_Name === 'Financial Status' &&
    d.Financial_Type?.toLowerCase().includes('cash flow') &&
    gpFilter(d)
  ).reduce((sum, d) => sum + toNumber(d.Value), 0)

  // Extract Project Info (Financial_Type = "General")
  const projectInfo = projectData.filter(d => d.Financial_Type === 'General')
  
  const getProjectInfoValue = (dataType: string) => {
    const row = projectInfo.find(d => d.Data_Type === dataType)
    const val = row ? String(row.Value) : ''
    return (val && val !== 'Nil') ? val : 'N/A'
  }

  return {
    'Business Plan GP': bp,
    'Projected GP': proj,
    'WIP GP': wip,
    'Cash Flow': cf,
    'Start Date': getProjectInfoValue('Start Date'),
    'Complete Date': getProjectInfoValue('Complete Date'),
    'Target Complete Date': getProjectInfoValue('Target Complete Date'),
    'Time Consumed (%)': getProjectInfoValue('Time Consumed (%)'),
    'Target Completed (%)': getProjectInfoValue('Target Completed (%)')
  }
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
    results[ft] = filtered.reduce((sum, d) => sum + toNumber(d.Value), 0)
  }

  const displayName = categoryName.charAt(0).toUpperCase() + categoryName.slice(1)
  let response = `## Monthly ${displayName} (${targetMonth}/${month}) ('000)\n\n`

  for (const [ft, value] of Object.entries(results)) {
    response += `- **${ft}:** $${value.toLocaleString()}\n`
  }

  return response
}

// ============================================
// New Query Logic (Revised)
// ============================================

interface ParsedQuery {
  year?: string
  month?: string
  sheetName?: string
  financialType?: string
  dataType?: string
  itemCode?: string
}

interface FuzzyResult {
  text: string
  candidates: Array<{
    id: number
    value: number | string
    score: number
    sheet: string
    financialType: string
    dataType: string
    itemCode: string
    month: string
    year: string
    matchedKeywords: string[]
  }>
}

// Parse date from question - maps "january 2025" or "2025 jan" or "jan" or "feb 25" to month/year
function parseDate(question: string, defaultMonth: string): ParsedQuery {
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const monthMap: Record<string, string> = {}
  monthNames.forEach((name, i) => monthMap[name] = String(i + 1))
  monthAbbr.forEach((abbr, i) => monthMap[abbr] = String(i + 1))

  const result: ParsedQuery = {}
  const lowerQ = question.toLowerCase()

  // Find 4-digit year (2024, 2025, etc.)
  const yearMatch = lowerQ.match(/\b(20[2-4]\d)\b/)
  if (yearMatch) {
    result.year = yearMatch[1]
  }

  // Handle "M/YY" or "MM/YY" format like "2/25" or "02/25" → Feb 2025
  // This must be checked BEFORE 2-digit year
  const mmyyMatch = lowerQ.match(/(\d{1,2})\/(\d{2})\b/)
  if (mmyyMatch && !yearMatch) {
    const monthNum = mmyyMatch[1]
    const yearNum = mmyyMatch[2]
    // Validate month is 1-12
    const month = parseInt(monthNum)
    if (month >= 1 && month <= 12) {
      result.month = String(month)
      result.year = '20' + yearNum
    }
  }

  // Find 2-digit year (24, 25, etc.) - only if preceded by space and not part of month name
  // "feb 25" should be Feb + 2025, not Feb + month 25
  const twoDigitYearMatch = lowerQ.match(/\b(\d{2})\b(?!.*\d{4})/)
  if (twoDigitYearMatch && !yearMatch && !result.year) {
    const year = parseInt(twoDigitYearMatch[1])
    if (year >= 20 && year <= 30) {
      result.year = '20' + twoDigitYearMatch[1]
    }
  }

  // Find month name or abbreviation - only if it doesn't conflict with year
  for (let i = 0; i < monthNames.length; i++) {
    if (lowerQ.includes(monthNames[i]) || lowerQ.includes(monthAbbr[i])) {
      const monthNum = String(i + 1)
      // Only set month if it doesn't look like a year (e.g., don't treat "2025" as month 20)
      if (monthNum.length === 1 || (monthNum.length === 2 && monthNum !== '20' && monthNum !== '21' && monthNum !== '22' && monthNum !== '23')) {
        result.month = monthNum
      }
      break
    }
  }

  // If no month found, use default month
  if (!result.month) {
    result.month = defaultMonth
  }

  return result
}

// Find closest match for a value against a list of candidates using Levenshtein distance
function findClosestMatch(input: string, candidates: string[]): string | null {
  if (!input || candidates.length === 0) return null

  const normalizedInput = input.toLowerCase().trim()
  let bestMatch: string | null = null
  let bestDistance = Infinity

  for (const candidate of candidates) {
    const normalizedCand = candidate.toLowerCase().trim()
    
    // Exact match - return immediately
    if (normalizedInput === normalizedCand) return candidate
    
    // Check for EXACT SUBSTRING match - input must appear as a WHOLE WORD in candidate
    // Split candidate into words and check if input matches any word
    const candWords = normalizedCand.split(/\s+/)
    let isWordMatch = false
    for (let i = 0; i < candWords.length; i++) {
      const word = candWords[i]
      // Input must match a candidate word EXACTLY, or be a substantial part (50%+) of that word
      if (word === normalizedInput) {
        isWordMatch = true
        break
      }
      // Check if word contains input OR input contains word (and input is substantial part)
      if (word.includes(normalizedInput)) {
        // Input is substring of word - only accept if input is at least 50% of the word
        if (normalizedInput.length >= word.length * 0.5) {
          isWordMatch = true
          break
        }
      }
    }
    
    if (isWordMatch) {
      // It's a word-level match
      const distance = Math.abs(normalizedCand.length - normalizedInput.length)
      if (distance < bestDistance) {
        bestDistance = distance
        bestMatch = candidate
      }
      continue
    }

    // For fuzzy matching (not substring), check character similarity
    const inputChars: Record<string, boolean> = {}
    for (let i = 0; i < normalizedInput.length; i++) {
      const c = normalizedInput[i]
      if (c !== ' ') inputChars[c] = true
    }
    const candChars: Record<string, boolean> = {}
    for (let i = 0; i < normalizedCand.length; i++) {
      const c = normalizedCand[i]
      if (c !== ' ') candChars[c] = true
    }
    let sharedChars = 0
    for (const c in inputChars) {
      if (candChars[c]) sharedChars++
    }
    const totalChars = Object.keys(inputChars).length + Object.keys(candChars).length - sharedChars
    const similarity = totalChars > 0 ? sharedChars / totalChars : 0
    
    // Only consider fuzzy match if at least 60% character similarity
    if (similarity < 0.6) continue

    // Levenshtein distance for fuzzy matching
    const distance = levenshteinDistance(normalizedInput, normalizedCand)
    if (distance < bestDistance) {
      bestDistance = distance
      bestMatch = candidate
    }
  }

  // Only return if reasonably close (word match OR very close fuzzy match)
  if (bestMatch && bestDistance <= normalizedInput.length / 2) {
    return bestMatch
  }
  return null
}

// Levenshtein distance calculation
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

// Format currency without decimals - e.g., $20.01 → $20
function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString()}`
}

// Get all unique values for a column
function getUniqueValues(data: FinancialRow[], project: string, field: keyof FinancialRow): string[] {
  const projectData = data.filter(d => d._project === project)
  const values = new Set<string>()
  projectData.forEach(row => {
    const val = row[field]
    if (val) values.add(String(val))
  })
  return Array.from(values)
}

// Main query handler with new logic
function answerQuestion(data: FinancialRow[], project: string, question: string, defaultMonth: string): FuzzyResult {
  const expandedQuestion = expandAcronyms(question).toLowerCase()
  // Get significant words from the question (after acronym expansion)
  // IMPORTANT: Keep ALL words including short ones like "np" which may be acronyms
  const questionWords = expandedQuestion.split(/\s+/).filter(w => w.length > 0)
  const projectData = data.filter(d => d._project === project)

  if (projectData.length === 0) {
    return { text: 'No data found for this project.', candidates: [] }
  }

  // Step 1: Parse date → month, year
  const parsedDate = parseDate(expandedQuestion, defaultMonth)

  // Step 2: Check Sheet_Name
  // IF user didn't specify any date (only using defaults): default to "Financial Status"
  // IF user specified a date: check if user mentioned a specific sheet
  let targetSheet: string | undefined
  const sheets = getUniqueValues(data, project, 'Sheet_Name')
  
  // Detect if user actually specified a date (not just using defaults)
  const userSpecifiedYear = parsedDate.year && parsedDate.year !== String(new Date().getFullYear())
  const userSpecifiedMonth = parsedDate.month && parsedDate.month !== defaultMonth
  const hasUserDate = userSpecifiedYear || userSpecifiedMonth
  
  if (!hasUserDate) {
    // No date specified by user → Default to Financial Status, skip sheet detection
    targetSheet = 'Financial Status'
  } else {
    // Date specified by user → Check if user explicitly mentioned a sheet
    // First try: check if user explicitly mentioned a sheet
    for (const sheet of sheets) {
      const sheetLower = sheet.toLowerCase()
      // Check if sheet name appears in question (with or without "sheet")
      if (expandedQuestion.includes(sheetLower.replace(/\s+/g, '')) ||
          expandedQuestion.includes(sheetLower.split(' ')[0])) {
        targetSheet = sheet
        break
      }
    }
    
    // Second: check for common sheet name keywords even without "sheet" prefix
    if (!targetSheet) {
      const sheetKeywords: Record<string, string> = {
        'cashflow': 'Cash Flow',
        'cash flow': 'Cash Flow',
        'projection': 'Projection',
        'committed': 'Committed Cost',
        'accrual': 'Accrual',
        'financial status': 'Financial Status',
        'financial': 'Financial Status'
      }
      for (const [keyword, sheetName] of Object.entries(sheetKeywords)) {
        // Check if keyword is in expanded question (as standalone word/phrase)
        const keywordRegex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i')
        if (keywordRegex.test(expandedQuestion)) {
          // Verify this sheet actually exists in the data (handle whitespace/blank issues)
          const found = sheets.find(s => s && s.trim() && s.trim().toLowerCase() === sheetName.toLowerCase())
          if (found) {
            targetSheet = found
            break
          }
        }
      }
    }
  }

  // Step 3: Get unique Financial_Type and Data_Type from data
  const financialTypes = getUniqueValues(data, project, 'Financial_Type')
  const dataTypes = getUniqueValues(data, project, 'Data_Type')
  // sheets is already defined in Step 2 above

  // Step 4: Extract Financial_Type from question (find closest match)
  // IMPORTANT: "projected" should map to Financial_Type like "Projection as at"
  // We should NOT skip Financial_Type just because it contains a Sheet_Name
  let targetFinType: string | undefined
  for (const ft of financialTypes) {
    const ftLower = ft.toLowerCase()
    // Check if any question word matches any Financial_Type word
    // IMPORTANT: Keep short words like "np" which may be acronyms
    const ftWords = ftLower.split(/\s+/).filter(w => w.length > 0)
    for (const qWord of questionWords) {
      for (const ftWord of ftWords) {
        // Exact word match OR word contains substring with 50%+ threshold
        if (qWord === ftWord) {
          targetFinType = ft
          break
        }
        if (ftWord.includes(qWord) && qWord.length >= ftWord.length * 0.5) {
          targetFinType = ft
          break
        }
      }
      if (targetFinType) break
    }
    if (targetFinType) break
  }
  // If no match found, use fuzzy matching
  if (!targetFinType) {
    for (const word of questionWords) {
      const match = findClosestMatch(word, financialTypes)
      if (match) {
        targetFinType = match
        break
      }
    }
  }

  // Step 5: Extract Data_Type from question (find closest match)
  // IMPORTANT: "gp" / "np" should map to Data_Type like "Gross Profit" / "Net Profit"
  
  // Special mapping for common acronyms (must come first!)
  const acronymMap: Record<string, string[]> = {
    'np': ['net profit', 'acc. net profit'],
    'gp': ['gross profit', 'acc. gross profit'],
    'wip': ['work in progress'],
    'cf': ['cash flow']
  }
  
  // Check if question contains any known acronyms
  for (const [acronym, expansions] of Object.entries(acronymMap)) {
    if (questionWords.includes(acronym)) {
      // Try to find a matching Data_Type in the data
      for (const expansion of expansions) {
        const match = dataTypes.find(dt => dt.toLowerCase().includes(expansion))
        if (match) {
          targetDataType = match
          break
        }
      }
      if (targetDataType) break
    }
  }
  
  // If no acronym match found, continue with regular matching
  let bestDataTypeMatchCount = 0
  
  if (!targetDataType) {
    for (const dt of dataTypes) {
      const dtLower = dt.toLowerCase()
      const dtWords = dtLower.split(/\s+/).filter(w => w.length > 0)
      
      // Count how many question words match this Data_Type
      let matchCount = 0
      const matchedWords: string[] = []
      for (const qWord of questionWords) {
        for (const dtWord of dtWords) {
          if (qWord === dtWord) {
            matchCount++
            matchedWords.push(qWord)
            break
          }
        }
      }
      
      // Partial matches for longer words (4+ chars)
      for (const qWord of questionWords) {
        if (matchedWords.includes(qWord)) continue
        if (qWord.length <= 3) continue
        
        for (const dtWord of dtWords) {
          const qLen = qWord.length
          const dLen = dtWord.length
          
          const longer = qLen >= dLen ? qWord : dtWord
          const shorter = qLen >= dLen ? dtWord : qWord
          
          if (longer.includes(shorter) && shorter.length >= longer.length * 0.5) {
            matchCount++
            matchedWords.push(qWord)
            break
          }
        }
      }
      
      if (matchCount > bestDataTypeMatchCount) {
        bestDataTypeMatchCount = matchCount
        targetDataType = dt
      }
    }
  }
  }
  
  // If no match found, use fuzzy matching with all significant words
  if (!targetDataType) {
    for (const word of questionWords) {
      const match = findClosestMatch(word, dataTypes)
      if (match) {
        targetDataType = match
        break
      }
    }
  }

  // Track which sheet was actually applied (for display)
  let appliedSheet = targetSheet

  // Build filter conditions
  let filtered = projectData

  // Apply Sheet_Name filter
  if (targetSheet) {
    filtered = filtered.filter(d => d.Sheet_Name === targetSheet)
    appliedSheet = targetSheet
  }

  // Apply month filter (if specified)
  if (parsedDate.month) {
    filtered = filtered.filter(d => d.Month === parsedDate.month)
  }

  // Apply year filter (if specified)
  if (parsedDate.year) {
    filtered = filtered.filter(d => d.Year === parsedDate.year)
  }

  // Apply Financial_Type filter (if found)
  if (targetFinType) {
    filtered = filtered.filter(d => d.Financial_Type === targetFinType)
  }

  // Apply Data_Type filter (if found)
  if (targetDataType) {
    filtered = filtered.filter(d => d.Data_Type === targetDataType)
  }

  // If no exact matches, relax filters progressively
  if (filtered.length === 0) {
    // Try without Financial_Type
    filtered = projectData
    if (targetSheet) filtered = filtered.filter(d => d.Sheet_Name === targetSheet)
    if (parsedDate.month) filtered = filtered.filter(d => d.Month === parsedDate.month)
    if (parsedDate.year) filtered = filtered.filter(d => d.Year === parsedDate.year)
    if (targetDataType) filtered = filtered.filter(d => d.Data_Type === targetDataType)
    appliedSheet = targetSheet || 'Financial Status'
  }

  if (filtered.length === 0) {
    // Try without Data_Type
    filtered = projectData
    if (targetSheet) filtered = filtered.filter(d => d.Sheet_Name === targetSheet)
    if (parsedDate.month) filtered = filtered.filter(d => d.Month === parsedDate.month)
    if (parsedDate.year) filtered = filtered.filter(d => d.Year === parsedDate.year)
    appliedSheet = targetSheet || 'Financial Status'
  }

  if (filtered.length === 0) {
    return { text: `No data found matching your query.\n\nFilters attempted:\n${appliedSheet ? `- Sheet: ${appliedSheet}\n` : ''}${parsedDate.month ? `- Month: ${parsedDate.month}\n` : ''}${parsedDate.year ? `- Year: ${parsedDate.year}\n` : ''}${targetFinType ? `- Financial Type: ${targetFinType}\n` : ''}${targetDataType ? `- Data Type: ${targetDataType}` : ''}`, candidates: [] }
  }

  // Helper to convert Value to number safely
  const toNumber = (val: number | string): number => {
    if (typeof val === 'number') return val
    return parseFloat(val) || 0
  }

  // Format results
  const total = filtered.reduce((sum, d) => sum + toNumber(d.Value), 0)

  // Get unique Item_Codes for display
  const itemGroups = new Map<string, FinancialRow[]>()
  filtered.forEach(d => {
    const key = d.Item_Code || 'Unknown'
    if (!itemGroups.has(key)) itemGroups.set(key, [])
    itemGroups.get(key)!.push(d)
  })

  let response = `## Query Results\n\n`
  response += `**Filters:**\n`
  // Show which sheet was used
  if (appliedSheet) response += `• Sheet: ${appliedSheet}\n`
  // Show Financial Type filter
  if (targetFinType) response += `• Financial Type: ${targetFinType}\n`
  // Show month - only show actual month if user specified it
  response += `• Month: ${hasUserDate && parsedDate.month ? parsedDate.month : 'All'}\n`
  // Show year - only show actual year if user specified it
  response += `• Year: ${hasUserDate && parsedDate.year ? parsedDate.year : 'All'}\n`
  response += `• Data Type: ${targetDataType || 'All'}\n`
  response += `• Item Code: all\n\n`

  response += `**Total: ${formatCurrency(total)}** ('000)\n\n`

  response += `**By Item Code:**\n`
  itemGroups.forEach((rows, itemCode) => {
    const itemTotal = rows.reduce((sum, d) => sum + toNumber(d.Value), 0)
    response += `• Item ${itemCode}: ${formatCurrency(itemTotal)}\n`
  })

  // Create candidates for clickable selection
  // ALWAYS score ALL project data records and show top 10 best matches
  // Include keyword matching across ALL fields for comprehensive scoring
  const allCandidates = projectData.map((d) => {
    let matchScore = 0
    const matchedKeywords: string[] = []
    
    // Build combined text from all searchable fields
    const combinedText = `${d.Sheet_Name} ${d.Financial_Type} ${d.Data_Type} ${d.Item_Code} ${d.Month} ${d.Year}`.toLowerCase()
    
    // Check each question word against ALL fields
    for (const qWord of questionWords) {
      // Financial_Type match
      if (d.Financial_Type.toLowerCase().includes(qWord)) {
        matchScore += 5
        matchedKeywords.push(qWord)
      }
      
      // Data_Type match (important!)
      if (d.Data_Type.toLowerCase().includes(qWord)) {
        matchScore += 8
        matchedKeywords.push(qWord)
      }
      
      // Item_Code match
      if (d.Item_Code.toLowerCase().includes(qWord)) {
        matchScore += 3
        matchedKeywords.push(qWord)
      }
      
      // Sheet_Name match
      if (d.Sheet_Name.toLowerCase().includes(qWord)) {
        matchScore += 2
        matchedKeywords.push(qWord)
      }
    }
    
    // Explicit Financial_Type match (high priority)
    if (targetFinType && d.Financial_Type === targetFinType) matchScore += 40
    else if (targetFinType && d.Financial_Type.toLowerCase().includes(targetFinType.toLowerCase())) {
      matchScore += 30
      matchedKeywords.push(targetFinType)
    }
    
    // Explicit Data_Type match (high priority)
    if (targetDataType && d.Data_Type === targetDataType) matchScore += 35
    else if (targetDataType && d.Data_Type.toLowerCase().includes(targetDataType.toLowerCase())) {
      matchScore += 25
      matchedKeywords.push(targetDataType)
    }
    
    // Month match
    if (parsedDate.month && d.Month === parsedDate.month) matchScore += 20
    
    // Year match
    if (parsedDate.year && d.Year === parsedDate.year) matchScore += 15
    
    // Bonus for common item codes
    if (d.Item_Code === '3' || d.Item_Code === '1' || d.Item_Code === '2') matchScore += 5
    
    // Bonus for Financial Status (default sheet)
    if (d.Sheet_Name === 'Financial Status') matchScore += 2
    
    return {
      id: 0, // Will be reassigned
      value: d.Value,
      score: matchScore,
      sheet: d.Sheet_Name,
      financialType: d.Financial_Type,
      dataType: d.Data_Type,
      itemCode: d.Item_Code,
      month: d.Month,
      year: d.Year,
      matchedKeywords: Array.from(new Set(matchedKeywords)) // Remove duplicates
    }
  }).sort((a, b) => b.score - a.score).slice(0, 10)

  // Reassign IDs after sorting
  const candidates = allCandidates.map((c, i) => ({ ...c, id: i + 1 }))

  if (candidates.length > 0) {
    response += `\n**Available Records (click to select):**\n`
    candidates.forEach((c) => {
      const matches = c.matchedKeywords.length > 0 ? ` [Matched: ${c.matchedKeywords.join(', ')}]` : ''
      response += `[${c.id}] ${c.month}/${c.year}/${c.sheet}/${c.financialType}/${c.dataType}/${c.itemCode}: ${formatCurrency(toNumber(c.value))} [Score: ${c.score}]${matches}\n`
    })
  }

  return { text: response, candidates }
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
        
        // Debug info
        const debug = {
          source: `Google Drive: Ai Chatbot Knowledge Base/${year}/${month}/${projectFile}`,
          totalRows: data.length,
          // Show raw values from CSV
          sampleRows: data.slice(0, 3).map(d => ({
            Sheet: d.Sheet_Name,
            FinType: d.Financial_Type,
            Item: d.Item_Code,
            Data: d.Data_Type,
            Value: d.Value
          })),
          uniqueSheets: Array.from(new Set(data.map(d => d.Sheet_Name))),
          uniqueFinancialTypes: Array.from(new Set(data.map(d => d.Financial_Type))),
          uniqueItemCodes: Array.from(new Set(data.map(d => d.Item_Code))),
          uniqueDataTypes: Array.from(new Set(data.map(d => d.Data_Type))),
          gpRowsCount: data.filter(d => 
            d.Item_Code === '3' && 
            d.Data_Type?.toLowerCase().includes('gross profit')
          ).length
        }
        
        return NextResponse.json({ data, metrics, debug })
      }

      case 'query': {
        const data = await loadProjectData(projectFile, year, month)
        const result = answerQuestion(data, project, question, month)
        return NextResponse.json({ response: result.text, candidates: result.candidates })
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
