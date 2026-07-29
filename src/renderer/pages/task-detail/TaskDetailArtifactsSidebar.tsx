import React, { useEffect, useRef, useState } from 'react'
import { Empty, Spin, Tabs, Table, Tooltip } from 'antd'
import { renderAsync as renderDocx } from 'docx-preview'
import * as XLSX from 'xlsx'
import * as pdfjsLib from 'pdfjs-dist'

// 配置 PDF.js 的 Worker 运行源地址
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
import {
  FileText,
  FileSpreadsheet,
  FileCode,
  FileImage,
  File,
  Menu,
  RotateCw,
  Maximize2,
  Minimize2,
  X,
  ChevronDown,
  ChevronRight,
  Music,
  Video,
} from 'lucide-react'
import type { WorkspaceArtifact } from '../../../shared/types.js'
import { rendererApi } from '../../api/bridge.js'
import { renderMarkdown } from '../../utils/markdown.js'
import { useTaskDetail } from './TaskDetailContext.js'

/**
 * 根据文件扩展名返回对应的图标与醒目配色
 */
function getFileIcon(extension: string) {
  const ext = extension.toLowerCase()
  if (['docx', 'doc'].includes(ext)) {
    return <FileText size={16} style={{ color: '#2563eb' }} />
  }
  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return <FileSpreadsheet size={16} style={{ color: '#16a34a' }} />
  }
  if (['pdf'].includes(ext)) {
    return <FileText size={16} style={{ color: '#dc2626' }} />
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    return <FileImage size={16} style={{ color: '#9333ea' }} />
  }
  if (['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) {
    return <Music size={16} style={{ color: '#059669' }} />
  }
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) {
    return <Video size={16} style={{ color: '#d97706' }} />
  }
  if (['md', 'markdown', 'txt', 'json', 'html'].includes(ext)) {
    return <FileCode size={16} style={{ color: '#0284c7' }} />
  }
  return <File size={16} style={{ color: '#64748b' }} />
}

/**
 * Base64 文本转 ArrayBuffer (供 docx-preview 与 SheetJS 解析使用)
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * DOCX 格式文件渲染组件 (使用 docx-preview)
 */
function DocxPreviewer({ file }: { file: WorkspaceArtifact }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    async function loadDocx() {
      try {
        const res = await rendererApi.workspace.readFile(file.absolutePath, 'base64')
        if (!res.ok) {
          throw new Error(res.error.message)
        }
        const buffer = base64ToArrayBuffer(res.data)
        if (containerRef.current && active) {
          containerRef.current.innerHTML = ''
          await renderDocx(buffer, containerRef.current, undefined, {
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            experimental: true,
          })
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : '无法解析 DOCX 文档')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadDocx()
    return () => {
      active = false
    }
  }, [file.absolutePath])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Spin tip="正在渲染 DOCX 文档..." />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Empty description={`DOCX 预览失败: ${error}`} />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        background: '#f8fafc',
        padding: '16px',
        boxSizing: 'border-box',
      }}
    />
  )
}

/**
 * XLSX 格式文件渲染组件 (使用 xlsx / SheetJS + AntD Table)
 */
function XlsxPreviewer({ file }: { file: WorkspaceArtifact }) {
  const [loading, setLoading] = useState(true)
  const [sheets, setSheets] = useState<{ name: string; columns: any[]; data: any[] }[]>([])
  const [activeSheet, setActiveSheet] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    async function loadXlsx() {
      try {
        const res = await rendererApi.workspace.readFile(file.absolutePath, 'base64')
        if (!res.ok) {
          throw new Error(res.error.message)
        }
        const workbook = XLSX.read(res.data, { type: 'base64' })
        const parsedSheets = workbook.SheetNames.map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName]
          const jsonRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 })
          if (jsonRows.length === 0) {
            return { name: sheetName, columns: [], data: [] }
          }
          const headerRow = (jsonRows[0] as unknown[]) || []
          const columns = headerRow.map((col, index) => {
            const title = String(col ?? `列 ${index + 1}`)
            return {
              title,
              dataIndex: `col_${index}`,
              key: `col_${index}`,
              ellipsis: true,
            }
          })

          const data = jsonRows.slice(1).map((rowArray: any, rowIndex: number) => {
            const rowObj: Record<string, unknown> = { key: `row_${rowIndex}` }
            headerRow.forEach((_, colIndex) => {
              rowObj[`col_${colIndex}`] = rowArray?.[colIndex] ?? ''
            })
            return rowObj
          })

          return { name: sheetName, columns, data }
        })

        if (active) {
          setSheets(parsedSheets)
          if (parsedSheets.length > 0) {
            setActiveSheet(parsedSheets[0].name)
          }
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : '无法解析 Excel 表格')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadXlsx()
    return () => {
      active = false
    }
  }, [file.absolutePath])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Spin tip="正在解析 Excel 表格..." />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Empty description={`Excel 预览失败: ${error}`} />
      </div>
    )
  }

  const currentSheetData = sheets.find((s) => s.name === activeSheet)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#ffffff' }}>
      {sheets.length > 1 && (
        <div style={{ borderBottom: '1px solid #e2e8f0', padding: '0 16px', background: '#f8fafc' }}>
          <Tabs
            activeKey={activeSheet}
            onChange={setActiveSheet}
            items={sheets.map((s) => ({ key: s.name, label: s.name }))}
            size="small"
          />
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {currentSheetData && (
          <Table
            columns={currentSheetData.columns}
            dataSource={currentSheetData.data}
            pagination={{ pageSize: 50, showSizeChanger: true }}
            size="small"
            bordered
            scroll={{ x: 'max-content' }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * 使用 Mozilla PDF.js (pdfjs-dist) 插件渲染的专业 PDF 预览组件
 */
function PdfPreviewer({ file }: { file: WorkspaceArtifact }) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState<number>(0)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [scale, setScale] = useState<number>(1.2)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<any>(null)

  // 初始化并解析 PDF 文档数据
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setPdfDoc(null)
    setCurrentPage(1)

    async function loadPdfDocument() {
      try {
        const res = await rendererApi.workspace.readFile(file.absolutePath, 'base64')
        if (!res.ok) {
          throw new Error(res.error.message)
        }
        const buffer = base64ToArrayBuffer(res.data)
        const loadingTask = pdfjsLib.getDocument({ data: buffer })
        const doc = await loadingTask.promise
        if (active) {
          setPdfDoc(doc)
          setNumPages(doc.numPages)
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : '无法解析 PDF 文档')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadPdfDocument()
    return () => {
      active = false
    }
  }, [file.absolutePath])

  // 渲染当前页到 Canvas 画布
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    const doc = pdfDoc

    let isCancelled = false

    async function renderPage() {
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel()
        }
        const page = await doc.getPage(currentPage)
        if (isCancelled) return

        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current!
        const context = canvas.getContext('2d')!

        const outputScale = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = Math.floor(viewport.width) + 'px'
        canvas.style.height = Math.floor(viewport.height) + 'px'

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined

        const renderContext = {
          canvasContext: context,
          transform,
          viewport,
          canvas,
        }

        const renderTask = page.render(renderContext)
        renderTaskRef.current = renderTask
        await renderTask.promise
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('PDF 页面绘制失败:', err)
        }
      }
    }

    renderPage()

    return () => {
      isCancelled = true
    }
  }, [pdfDoc, currentPage, scale])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Spin tip="正在解析 PDF 文档插件..." />
      </div>
    )
  }

  if (error || !pdfDoc) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Empty description={error || '无法解析 PDF 文件'} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#525659' }}>
      {/* 顶部 PDF 控制工具栏 */}
      <div
        style={{
          height: '40px',
          background: '#323639',
          borderBottom: '1px solid #2a2e31',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          color: '#e8eaed',
          fontSize: '13px',
          userSelect: 'none',
        }}
      >
        {/* 页码导航栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            style={{
              border: 'none',
              background: currentPage <= 1 ? 'transparent' : '#45494d',
              color: currentPage <= 1 ? '#73777a' : '#ffffff',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
            }}
          >
            上一页
          </button>
          <span>
            {currentPage} / {numPages} 页
          </span>
          <button
            disabled={currentPage >= numPages}
            onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
            style={{
              border: 'none',
              background: currentPage >= numPages ? 'transparent' : '#45494d',
              color: currentPage >= numPages ? '#73777a' : '#ffffff',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: currentPage >= numPages ? 'not-allowed' : 'pointer',
              fontSize: '12px',
            }}
          >
            下一页
          </button>
        </div>

        {/* 比例缩放按钮组 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}
            style={{
              border: 'none',
              background: '#45494d',
              color: '#ffffff',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            -
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(3.0, s + 0.2))}
            style={{
              border: 'none',
              background: '#45494d',
              color: '#ffffff',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            +
          </button>
          <button
            onClick={() => setScale(1.2)}
            style={{
              border: 'none',
              background: '#45494d',
              color: '#ffffff',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: '12px',
              marginLeft: '4px',
            }}
          >
            复位
          </button>
        </div>
      </div>

      {/* PDF 画布显示区域 */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '24px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            background: '#ffffff',
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  )
}

/**
 * Markdown / 文本格式预览组件
 */
function MarkdownPreviewer({ file }: { file: WorkspaceArtifact }) {
  const [text, setText] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function loadText() {
      try {
        const res = await rendererApi.workspace.readFile(file.absolutePath, 'utf8')
        if (res.ok && active) {
          setText(res.data)
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (active) setLoading(false)
      }
    }
    loadText()
    return () => {
      active = false
    }
  }, [file.absolutePath])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Spin tip="正在加载文本..." />
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 32px', height: '100%', overflow: 'auto', background: '#ffffff', boxSizing: 'border-box' }}>
      {/* 成果预览统一采用与对话消息一致的 Markdown 格式与样式 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', color: '#334155', fontSize: '14px', lineHeight: '1.6' }}>
        {renderMarkdown(text)}
      </div>
    </div>
  )
}

/**
 * 图片预览组件
 */
function ImagePreviewer({ file }: { file: WorkspaceArtifact }) {
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function loadImage() {
      try {
        const res = await rendererApi.workspace.readFile(file.absolutePath, 'base64')
        if (res.ok && active) {
          const mime = file.extension === 'svg' ? 'image/svg+xml' : `image/${file.extension}`
          setImgUrl(`data:${mime};base64,${res.data}`)
        }
      } catch (err) {
        console.error(err)
      } finally {
        if (active) setLoading(false)
      }
    }
    loadImage()
    return () => {
      active = false
    }
  }, [file.absolutePath, file.extension])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Spin tip="正在加载图片..." />
      </div>
    )
  }

  if (!imgUrl) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Empty description="无法载入图片" />
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '24px', background: '#0f172a' }}>
      <img
        src={imgUrl}
        alt={file.name}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}
      />
    </div>
  )
}

/**
 * 音频格式文件 (wav, mp3, ogg 等) 内嵌播放组件
 */
function AudioPreviewer({ file }: { file: WorkspaceArtifact }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function loadAudio() {
      try {
        const res = await rendererApi.workspace.readFile(file.absolutePath, 'base64')
        if (res.ok && active) {
          const ext = file.extension.toLowerCase()
          const mime = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : `audio/${ext}`
          setAudioUrl(`data:${mime};base64,${res.data}`)
        } else if (!res.ok && active) {
          setError(res.error?.message || '读取音频文件失败')
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '无法载入音频文件')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadAudio()
    return () => {
      active = false
    }
  }, [file.absolutePath, file.extension])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Spin tip="正在加载音频..." />
      </div>
    )
  }

  if (error || !audioUrl) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Empty description={error || '无法播放音频'} />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '32px',
        background: '#f8fafc',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          padding: '32px',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.08), 0 8px 10px -6px rgba(0,0,0,0.04)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
          width: '100%',
          maxWidth: '420px',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: '#ecfdf5',
            display: 'grid',
            placeItems: 'center',
            color: '#059669',
          }}
        >
          <Music size={32} />
        </div>
        <div style={{ textAlign: 'center', width: '100%' }}>
          <div
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: '#0f172a',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.name}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
            .{file.extension.toUpperCase()} 音频文件
          </div>
        </div>
        <audio controls src={audioUrl} style={{ width: '100%', outline: 'none' }} />
      </div>
    </div>
  )
}

/**
 * 视频格式文件 (mp4, webm, mov 等) 内嵌播放组件
 */
function VideoPreviewer({ file }: { file: WorkspaceArtifact }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function loadVideo() {
      try {
        const res = await rendererApi.workspace.readFile(file.absolutePath, 'base64')
        if (res.ok && active) {
          const ext = file.extension.toLowerCase()
          const mime = ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : `video/${ext}`
          setVideoUrl(`data:${mime};base64,${res.data}`)
        } else if (!res.ok && active) {
          setError(res.error?.message || '读取视频文件失败')
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '无法载入视频文件')
      } finally {
        if (active) setLoading(false)
      }
    }
    loadVideo()
    return () => {
      active = false
    }
  }, [file.absolutePath, file.extension])

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Spin tip="正在加载视频..." />
      </div>
    )
  }

  if (error || !videoUrl) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
        <Empty description={error || '无法播放视频'} />
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        padding: '24px',
        background: '#0f172a',
        boxSizing: 'border-box',
      }}
    >
      <video
        controls
        src={videoUrl}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          outline: 'none',
        }}
      />
    </div>
  )
}

/**
 * 通用文件分发预览器组件
 */
function ArtifactFileViewer({ file }: { file: WorkspaceArtifact }) {
  const ext = file.extension.toLowerCase()
  if (['docx', 'doc'].includes(ext)) {
    return <DocxPreviewer file={file} />
  }
  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return <XlsxPreviewer file={file} />
  }
  if (['pdf'].includes(ext)) {
    return <PdfPreviewer file={file} />
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    return <ImagePreviewer file={file} />
  }
  if (['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) {
    return <AudioPreviewer file={file} />
  }
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) {
    return <VideoPreviewer file={file} />
  }
  if (['md', 'markdown', 'txt', 'json', 'html'].includes(ext)) {
    return <MarkdownPreviewer file={file} />
  }
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '40px' }}>
      <Empty description={`暂不支持 .${ext} 文件格式的在线预览`} />
    </div>
  )
}

/**
 * 参照 WorkBuddy 界面与布局规则的成果 (产物) 文件预览侧边栏组件
 */
/**
 * 成果 (产物) 文件预览与展示侧边栏组件 (参照 WorkBuddy 图 2 列表概览模式与图 3 详情/多页签/目录浮窗模式)
 */
export default function TaskDetailArtifactsSidebar() {
  const {
    artifacts,
    isArtifactsPanelOpen,
    selectedArtifact,
    setSelectedArtifact,
    openedArtifacts,
    closeArtifactTab,
    setIsArtifactsPanelOpen,
    scanArtifacts,
    isScanningArtifacts,
  } = useTaskDetail()

  const [isOverviewExpanded, setIsOverviewExpanded] = useState(true)
  const [isProductsExpanded, setIsProductsExpanded] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isDirectoryPopoverOpen, setIsDirectoryPopoverOpen] = useState(false)

  if (!isArtifactsPanelOpen) {
    return null
  }

  return (
    <div
      style={{
        width: isFullscreen ? '100%' : '480px',
        maxWidth: isFullscreen ? '100%' : '60%',
        height: '100%',
        background: '#ffffff',
        borderLeft: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        position: isFullscreen ? 'fixed' : 'relative',
        top: isFullscreen ? 0 : undefined,
        right: isFullscreen ? 0 : undefined,
        zIndex: isFullscreen ? 1000 : 10,
        boxShadow: isFullscreen ? '0 0 40px rgba(0,0,0,0.15)' : '-4px 0 16px rgba(0,0,0,0.02)',
        transition: 'width 0.2s ease, max-width 0.2s ease',
      }}
    >
      {/* 顶部工具栏 Header (包含模式控制、标签页卡与操作按钮) */}
      <div
        style={{
          height: '48px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          background: '#ffffff',
          userSelect: 'none',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1, overflow: 'hidden' }}>
          {/* 左侧菜单/目录浮窗触发图标 (图 2 / 图 3 统一样式) */}
          <Tooltip title={selectedArtifact ? (isDirectoryPopoverOpen ? '收起文件目录' : '查看文件目录与概览') : '成果目录'}>
            <button
              onClick={() => {
                if (selectedArtifact) {
                  setIsDirectoryPopoverOpen(!isDirectoryPopoverOpen)
                } else {
                  setIsDirectoryPopoverOpen(false)
                }
              }}
              style={{
                border: 'none',
                background: isDirectoryPopoverOpen ? '#f1f5f9' : 'transparent',
                borderRadius: '6px',
                padding: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                color: '#475569',
                flexShrink: 0,
              }}
            >
              <Menu size={18} />
            </button>
          </Tooltip>

          {/* 当处于图 3 详情模式时，顶部显示已打开的文件标签卡 Tabs 列表 */}
          {selectedArtifact && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflowX: 'auto', flex: 1, padding: '2px 0' }}>
              {openedArtifacts.map((tabItem) => {
                const isCurrentActive = selectedArtifact.id === tabItem.id
                return (
                  <div
                    key={tabItem.id}
                    onClick={() => setSelectedArtifact(tabItem)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      background: isCurrentActive ? '#f1f5f9' : '#f8fafc',
                      border: isCurrentActive ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                      fontSize: '13px',
                      color: isCurrentActive ? '#0f172a' : '#475569',
                      fontWeight: isCurrentActive ? 600 : 400,
                      cursor: 'pointer',
                      maxWidth: '220px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {getFileIcon(tabItem.extension)}
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tabItem.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        closeArtifactTab(tabItem.id)
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        borderRadius: '4px',
                        padding: '2px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        color: '#94a3b8',
                        marginLeft: '2px',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = '#0f172a'
                        e.currentTarget.style.backgroundColor = '#cbd5e1'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = '#94a3b8'
                        e.currentTarget.style.backgroundColor = 'transparent'
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 右侧动作图标 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          <Tooltip title="刷新工作区产物">
            <button
              onClick={() => scanArtifacts()}
              style={{
                border: 'none',
                background: 'transparent',
                borderRadius: '6px',
                padding: '6px',
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              <RotateCw size={16} className={isScanningArtifacts ? 'animate-spin' : ''} />
            </button>
          </Tooltip>

          <Tooltip title={isFullscreen ? '退出全屏' : '全屏展开'}>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              style={{
                border: 'none',
                background: 'transparent',
                borderRadius: '6px',
                padding: '6px',
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </Tooltip>

          <Tooltip title="关闭面板">
            <button
              onClick={() => setIsArtifactsPanelOpen(false)}
              style={{
                border: 'none',
                background: 'transparent',
                borderRadius: '6px',
                padding: '6px',
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              <X size={18} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 主体呈现区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* 模式一：图 2【概览与产物列表模式】 (当没有选中具体产物时渲染) */}
        {!selectedArtifact ? (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              background: '#ffffff',
              userSelect: 'none',
            }}
          >
            {/* 概览分组 */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 0',
                  cursor: 'pointer',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: '#1e293b',
                }}
              >
                <span>概览</span>
                {isOverviewExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>

              {isOverviewExpanded && (
                <div style={{ paddingLeft: '4px', paddingTop: '8px', fontSize: '13px', color: '#64748b' }}>
                  共 {artifacts.length} 项成果产物
                </div>
              )}
            </div>

            {/* 产物分组与大卡片列表 */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                onClick={() => setIsProductsExpanded(!isProductsExpanded)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 0',
                  cursor: 'pointer',
                  fontSize: '15px',
                  fontWeight: 600,
                  color: '#1e293b',
                }}
              >
                <span>产物</span>
                {isProductsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>

              {isProductsExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                  {artifacts.length === 0 ? (
                    <div style={{ padding: '16px', fontSize: '13px', color: '#94a3b8', background: '#f8fafc', borderRadius: '8px' }}>
                      未扫描到相关成果产物
                    </div>
                  ) : (
                    artifacts.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedArtifact(item)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px 16px',
                          borderRadius: '10px',
                          background: '#f8fafc',
                          color: '#0f172a',
                          fontWeight: 500,
                          fontSize: '14px',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          border: '1px solid #f1f5f9',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#f1f5f9'
                          e.currentTarget.style.borderColor = '#cbd5e1'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '#f8fafc'
                          e.currentTarget.style.borderColor = '#f1f5f9'
                        }}
                      >
                        {getFileIcon(item.extension)}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {item.name}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 模式二：图 3【产物详情预览模式】 (支持浮动 Popover 目录) */
          <div style={{ flex: 1, height: '100%', overflow: 'hidden', background: '#ffffff', position: 'relative' }}>
            {/* 选中的文件富内容预览 */}
            <ArtifactFileViewer file={selectedArtifact} />

            {/* 图 3 悬浮 Popover 目录 (当点击左上角 ☰ 按钮时弹出白底阴影框) */}
            {isDirectoryPopoverOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '12px',
                  left: '12px',
                  width: '280px',
                  maxHeight: '80%',
                  background: '#ffffff',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.15), 0 4px 8px rgba(0,0,0,0.06)',
                  padding: '16px',
                  zIndex: 50,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  overflowY: 'auto',
                  userSelect: 'none',
                }}
              >
                {/* 概览分组 */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div
                    onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 0',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#1e293b',
                    }}
                  >
                    <span>概览</span>
                    {isOverviewExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>

                  {isOverviewExpanded && (
                    <div style={{ paddingLeft: '4px', paddingTop: '4px', fontSize: '12px', color: '#64748b' }}>
                      共 {artifacts.length} 项成果产物
                    </div>
                  )}
                </div>

                {/* 产物分组 */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div
                    onClick={() => setIsProductsExpanded(!isProductsExpanded)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '4px 0',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#1e293b',
                    }}
                  >
                    <span>产物</span>
                    {isProductsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>

                  {isProductsExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                      {artifacts.map((item) => {
                        const isSelected = selectedArtifact.id === item.id
                        return (
                          <div
                            key={item.id}
                            onClick={() => {
                              setSelectedArtifact(item)
                              setIsDirectoryPopoverOpen(false)
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '8px 12px',
                              borderRadius: '8px',
                              background: isSelected ? '#f1f5f9' : '#f8fafc',
                              color: isSelected ? '#0f172a' : '#475569',
                              fontWeight: isSelected ? 600 : 400,
                              fontSize: '13px',
                              cursor: 'pointer',
                              border: isSelected ? '1px solid #cbd5e1' : '1px solid ' + '#f1f5f9',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {getFileIcon(item.extension)}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {item.name}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

