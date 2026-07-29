// 灵感广场文化分类 key
export type CultureTabKey =
  | 'all'
  | 'ancient'
  | 'opera'
  | 'panda'
  | 'teahouse'
  | 'craft'
  | 'scenery'

// 灵感唯一 ID 类型
export type InspirationId = string

// 灵感详情数据结构
export interface InspirationDetail {
  id: InspirationId
  icon: string
  category: string
  categoryColor: string
  title: string
  author: string
  authorAvatar: string
  authorTitle: string
  authorWorks: number
  authorFollowers: string
  date: string
  likes: string
  views: string
  saves: number
  tags: string[]
  highlights: Array<{ icon: string; label: string; value: string }>
  summary: string
  sections: Array<{ title: string; content: string }>
  references: Array<{ icon: string; title: string; type: string }>
  relatedIds: InspirationId[]
  coverImage?: string
}

// 灵感视频卡片数据结构
export interface InspirationCard {
  id: string
  inspirationId: InspirationId
  tabKey: Exclude<CultureTabKey, 'all'>
  title: string
  category: string
  icon: string
  tags: string[]
  author: string
  authorName: string
  likes: string
  saved: boolean
  imageUrl: string
  videoUrl: string
  prompt: string
}

// 分类 Tab 结构
export interface CultureCategoryTab {
  key: CultureTabKey
  label: string
  icon: string
  color: string
}
