import { useState, useRef, useEffect, useCallback, ReactNode, CSSProperties } from 'react'

/**
 * Popover 组件属性契约
 */
export interface PopoverProps {
  /** 弹出面板展示的内容 */
  content: ReactNode
  /** 触发 Popover 显示的子元素 */
  children: ReactNode
  /** 受控模式：当前面板是否显示 */
  open?: boolean
  /** 受控模式：面板显示/隐藏状态变更回调 */
  onOpenChange?: (open: boolean) => void
  /** 弹出位置定位，默认为 'topLeft' */
  placement?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight' | 'rightTop' | 'leftTop'
  /** 触发交互方式：'click' 点击触发 或 'hover' 悬停触发，默认为 'click' */
  trigger?: 'click' | 'hover'
  /** 自定义弹出层面板宽度 */
  width?: number | string
  /** 自定义外层容器样式 */
  style?: CSSProperties
  /** 自定义面板内容容器样式 */
  contentStyle?: CSSProperties
  /** 额外的容器 CSS 类名 */
  className?: string
}

/**
 * 丝滑手写全局 Popover 弹出层组件
 * 样式与交互基于 experts-popover-container 设计规范
 */
export default function Popover({
  content,
  children,
  open: controlledOpen,
  onOpenChange,
  placement = 'topLeft',
  trigger = 'click',
  width,
  style,
  contentStyle,
  className = '',
}: PopoverProps) {
  // 内部非受控展开状态
  const [internalOpen, setInternalOpen] = useState(false)
  // 是否正在展示（包含动画过程）
  const [isVisible, setIsVisible] = useState(false)
  // 动画状态：'enter' 表示渐入，'leave' 表示渐出
  const [animateState, setAnimateState] = useState<'enter' | 'leave'>('leave')

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : internalOpen

  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // 处理显示/隐藏状态更新
  const updateOpenState = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setInternalOpen(nextOpen)
      }
      onOpenChange?.(nextOpen)
    },
    [isControlled, onOpenChange]
  )

  // 监听 isOpen 变更，触发丝滑渐入渐出动画
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true)
      // 使用 requestAnimationFrame 保证 DOM 渲染完成后触发过渡
      const timer = requestAnimationFrame(() => {
        setAnimateState('enter')
      })
      return () => cancelAnimationFrame(timer)
    } else {
      setAnimateState('leave')
      // 等待 150ms 过渡动画结束后卸载 DOM 节点
      const timer = setTimeout(() => {
        setIsVisible(false)
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // 监听外部点击自动关闭 Popover
  useEffect(() => {
    if (!isOpen || trigger !== 'click') return

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return
      }
      updateOpenState(false)
    }

    document.addEventListener('mousedown', handleOutsideClick, true)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true)
    }
  }, [isOpen, trigger, updateOpenState])

  // 根据 placement 计算弹出面板定位样式（确保定位在触发元素上方）
  const getPlacementStyle = (): CSSProperties => {
    switch (placement) {
      case 'bottomLeft':
      case 'topLeft':
        return { bottom: 'calc(100% + 6px)', left: 0 }
      case 'bottomRight':
      case 'topRight':
        return { bottom: 'calc(100% + 6px)', right: 0 }
      case 'rightTop':
        return { top: 0, left: 'calc(100% + 8px)' }
      case 'leftTop':
        return { top: 0, right: 'calc(100% + 8px)' }
      default:
        return { bottom: 'calc(100% + 6px)', left: 0 }
    }
  }

  // 动画状态样式：从 scale(0.96) + opacity 0 丝滑放大过渡到 scale(1) + opacity 1
  // 上方弹出面板从底部 (bottom center) 向上升起放大
  const isTopPlacement = placement.startsWith('top') || placement.startsWith('bottom')
  const animationStyle: CSSProperties = {
    opacity: animateState === 'enter' ? 1 : 0,
    transform:
      animateState === 'enter'
        ? 'scale(1) translateY(0)'
        : isTopPlacement
          ? 'scale(0.96) translateY(4px)'
          : 'scale(0.96) translateY(-4px)',
    transition: 'opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
    transformOrigin: isTopPlacement ? 'bottom center' : placement.startsWith('right') ? 'top left' : 'top center',
  }

  // 点击触发处理
  const handleClick = (e: React.MouseEvent) => {
    if (trigger !== 'click') return
    e.stopPropagation()
    updateOpenState(!isOpen)
  }

  // Hover 触发处理
  const handleMouseEnter = () => {
    if (trigger === 'hover') {
      updateOpenState(true)
    }
  }

  const handleMouseLeave = () => {
    if (trigger === 'hover') {
      updateOpenState(false)
    }
  }

  return (
    <div
      style={{ position: 'relative', display: 'inline-block', ...style }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={className}
    >
      {/* 触发节点 */}
      <div ref={triggerRef} onClick={handleClick} style={{ display: 'inline-block', width: '100%' }}>
        {children}
      </div>

      {/* 弹出气泡面板（基于 experts-popover-container 高质感设计） */}
      {isVisible && (
        <div
          ref={popoverRef}
          className="experts-popover-container"
          style={{
            position: 'absolute',
            zIndex: 1000,
            width: width ?? 'auto',
            padding: '10px 12px',
            borderRadius: '12px',
            background: '#ffffff',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
            border: '1px solid #e2e8f0',
            ...getPlacementStyle(),
            ...animationStyle,
            ...contentStyle,
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
