// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useState} from 'react'

import {Board} from '../../blocks/board'
import {BoardView, PersonStatsPivotConfig, PersonStatsViewConfig} from '../../blocks/boardView'
import {Card} from '../../blocks/card'
import {useAppSelector} from '../../store/hooks'
import {getUser} from '../../store/users'
import {getCurrentBoard} from '../../store/boards'
import {RootState} from '../../store'
import {useHasCurrentBoardPermissions} from '../../hooks/permissions'
import {Permission} from '../../constants'
import {Utils} from '../../utils'
import {IUser} from '../../user'
import mutator from '../../mutator'

import {
    aggregatePerson,
    aggregatePivot,
    getMonthRange,
    getQuarterRange,
    getYearRange,
    DateRange,
    PersonFlowRow,
    PersonStatRow,
} from './aggregation'
import {
    convertAmount,
    DEFAULT_INTERNAL_RATE,
    getPersonStatsConfig,
    groupOf,
    PIVOT_LABELS,
    PIVOT_ORDER,
    PivotKey,
    rateOf,
    ResolvedPivot,
    resolvePivot,
    withGroup,
    withPivot,
    withRate,
} from './personStatsConfig'

import './personStats.scss'

type Props = {
    board: Board
    activeView: BoardView
    cards: Card[]
    readonly: boolean
}

type RangePreset = 'month' | 'quarter' | 'year' | 'custom'
type LayoutMode = 'table' | 'cards' | 'flow'
type StatsMode = 'summary' | PivotKey

export const formatDays = (v: number): string => v.toFixed(1)
export const formatAmount = (v: number): string => '¥' + v.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})
export const formatConverted = (v: number): string => v.toFixed(2)

const CATEGORY_LABEL: Record<string, string> = {
    scheduled: '已安排',
    completed: '已完成未结',
    settled: '已结算',
}

// Personnel statistics, management-only dashboard (2026-10-21
// three-layout build): KPI header + three switchable layouts
// (table / person cards / per-card settlement flow) over one shared
// aggregation, so every number ties out across layouts. Producer
// groups and per-person internal conversion rates are maintained by
// board admins and stored in the view's own fields.
const PersonStats = (props: Props): JSX.Element => {
    const board = useAppSelector(getCurrentBoard) || props.board
    const isAdmin = useHasCurrentBoardPermissions([Permission.ManageBoardRoles])
    const boardUsers = useAppSelector((state: RootState) => state.users?.boardUsers || {})

    const [preset, setPreset] = useState<RangePreset>('month')
    const [customStart, setCustomStart] = useState('')
    const [customEnd, setCustomEnd] = useState('')
    const [layout, setLayout] = useState<LayoutMode>('cards')
    const [mode, setMode] = useState<StatsMode>('summary')
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [showHelp, setShowHelp] = useState(false)
    const [query, setQuery] = useState('')
    const [showConverted, setShowConverted] = useState(true)

    const [config, setConfig] = useState<PersonStatsViewConfig>(() => getPersonStatsConfig(props.activeView))
    const configKey = JSON.stringify(props.activeView.fields.personStatsConfig || null)
    useEffect(() => {
        setConfig(getPersonStatsConfig(props.activeView))
    }, [props.activeView.id, configKey])

    const range: DateRange = useMemo(() => {
        if (preset === 'month') {
            return getMonthRange()
        }
        if (preset === 'quarter') {
            return getQuarterRange()
        }
        if (preset === 'year') {
            return getYearRange()
        }
        const start = customStart ? new Date(customStart + 'T00:00:00').getTime() : 0
        const end = customEnd ? new Date(customEnd + 'T23:59:59').getTime() : Date.now()
        return {start, end}
    }, [preset, customStart, customEnd])

    const hasRequiredProps = useMemo(() => {
        const names = board.cardProperties.map((p) => p.name)
        return names.includes('人天') && names.includes('完成度明细') && names.includes('项目状态')
    }, [board])

    const pivotDef = mode === 'summary' ? undefined : resolvePivot(config, board, mode)

    const {rows, flow} = useMemo(() => {
        if (!hasRequiredProps) {
            return {rows: [] as PersonStatRow[], flow: [] as PersonFlowRow[]}
        }
        if (mode === 'summary') {
            return aggregatePerson(board, props.cards, range)
        }
        const def = resolvePivot(config, board, mode)
        return aggregatePivot(board, props.cards, range, {
            datePropertyId: def.datePropertyId,
            statusValues: def.statusValues,
        })
    }, [board, props.cards, range, hasRequiredProps, mode, config])

    const displayNameOf = (userId: string): string => fullNameOf(boardUsers[userId], userId)

    const filteredRows = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) {
            return rows
        }
        return rows.filter((r) =>
            displayNameOf(r.userId).toLowerCase().includes(q) ||
            groupOf(config, r.userId).toLowerCase().includes(q))
    }, [rows, query, config, boardUsers])

    const filteredUserIds = useMemo(() => new Set(filteredRows.map((r) => r.userId)), [filteredRows])
    const filteredFlow = useMemo(
        () => flow.filter((f) => filteredUserIds.has(f.userId)).sort((a, b) => b.amount - a.amount),
        [flow, filteredUserIds],
    )

    const totals = useMemo(() => {
        const t: PersonStatRow = {
            userId: '__total__',
            totalDays: 0, scheduledDays: 0, completedDays: 0, settledDays: 0,
            totalAmount: 0, scheduledAmount: 0, completedAmount: 0, settledAmount: 0,
            projectCount: 0,
        }
        for (const r of rows) {
            t.totalDays += r.totalDays
            t.scheduledDays += r.scheduledDays
            t.completedDays += r.completedDays
            t.settledDays += r.settledDays
            t.totalAmount += r.totalAmount
            t.scheduledAmount += r.scheduledAmount
            t.completedAmount += r.completedAmount
            t.settledAmount += r.settledAmount
        }
        t.projectCount = new Set(flow.map((f) => f.cardId)).size
        return t
    }, [rows, flow])

    const convertedTotals = useMemo(() => {
        let total = 0
        let settled = 0
        let completed = 0
        for (const r of rows) {
            total += convertAmount(config, r.userId, r.totalAmount)
            settled += convertAmount(config, r.userId, r.settledAmount)
            completed += convertAmount(config, r.userId, r.completedAmount)
        }
        return {total, settled, completed}
    }, [rows, config])

    const saveConfig = (next: PersonStatsViewConfig) => {
        setConfig(next)
        if (props.readonly) {
            return
        }
        const newView: BoardView = {
            ...props.activeView,
            fields: {...props.activeView.fields, personStatsConfig: next},
        }
        mutator.updateBlock(board.id, newView, props.activeView, 'person stats config')
    }

    const applyRateToAll = (rate: number) => {
        let next = config
        for (const r of rows) {
            next = withRate(next, r.userId, rate)
        }
        saveConfig(next)
    }

    const exportCsv = () => {
        const header = ['制作人', '组别', '项目数', '总人天', '已安排人天', '已完成未结人天', '已结算人天', '总金额', '已安排金额', '已完成未结金额', '已结算金额', '内部比例(元/天)', '内部折算人天', '已结折算人天']
        const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`
        const lines = [header.map(esc).join(',')]
        for (const r of filteredRows) {
            lines.push([
                displayNameOf(r.userId), groupOf(config, r.userId), r.projectCount,
                formatDays(r.totalDays), formatDays(r.scheduledDays), formatDays(r.completedDays), formatDays(r.settledDays),
                r.totalAmount.toFixed(2), r.scheduledAmount.toFixed(2), r.completedAmount.toFixed(2), r.settledAmount.toFixed(2),
                rateOf(config, r.userId), formatConverted(convertAmount(config, r.userId, r.totalAmount)), formatConverted(convertAmount(config, r.userId, r.settledAmount)),
            ].map(esc).join(','))
        }
        const blob = new Blob(['\ufeff' + lines.join('\n')], {type: 'text/csv;charset=utf-8'})
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'person-stats.csv'
        a.click()
        URL.revokeObjectURL(url)
    }

    if (!isAdmin) {
        return (
            <div className='PersonStats'>
                <div className='PersonStats__forbidden'>
                    人员统计为管理者专用视图，需要看板管理员权限。
                </div>
            </div>
        )
    }

    const settledPct = totals.totalDays > 0 ? ((totals.settledDays / totals.totalDays) * 100).toFixed(1) : '0.0'

    return (
        <div className='PersonStats'>
            {!hasRequiredProps && (
                <div className='PersonStats__warning'>
                    此 board 缺少结算属性（需要：人天、完成度明细、项目状态）。请在结算 board（如 1ALL）中使用人员统计。
                </div>
            )}

            {hasRequiredProps && (
                <>
                    <div className='PersonStats__kpis'>
                        <div className='PersonStats__kpi'>
                            <div className='PersonStats__kpi-label'>总关联项目</div>
                            <div className='PersonStats__kpi-value'>{totals.projectCount} <span className='PersonStats__kpi-unit'>个任务</span></div>
                            <div className='PersonStats__kpi-sub'>{rows.length} 位制作人参与</div>
                        </div>
                        <div className='PersonStats__kpi'>
                            <div className='PersonStats__kpi-label'>总核算人天</div>
                            <div className='PersonStats__kpi-value PersonStats__kpi-value--days'>{formatDays(totals.totalDays)} <span className='PersonStats__kpi-unit'>天</span></div>
                            <div className='PersonStats__kpi-sub'>已结算：{formatDays(totals.settledDays)} 天（{settledPct}%）</div>
                        </div>
                        {showConverted && (
                            <div className='PersonStats__kpi PersonStats__kpi--accent'>
                                <div className='PersonStats__kpi-label'>总内部折算人天</div>
                                <div className='PersonStats__kpi-value PersonStats__kpi-value--conv'>{formatConverted(convertedTotals.total)} <span className='PersonStats__kpi-unit'>内部人天</span></div>
                                <div className='PersonStats__kpi-sub'>已结：{formatConverted(convertedTotals.settled)} 天 ｜ 待结：{formatConverted(convertedTotals.completed)} 天</div>
                            </div>
                        )}
                        <div className='PersonStats__kpi'>
                            <div className='PersonStats__kpi-label'>累计总金额（元）</div>
                            <div className='PersonStats__kpi-value PersonStats__kpi-value--amount'>{formatAmount(totals.totalAmount)}</div>
                            <div className='PersonStats__kpi-sub'>已结累计打款：{formatAmount(totals.settledAmount)}</div>
                        </div>
                    </div>

                    <div className='PersonStats__toolbar'>
                        <div className='PersonStats__tabs'>
                            <button
                                className={layout === 'cards' ? 'active' : ''}
                                onClick={() => setLayout('cards')}
                            >
                                {'📂 卡片视图'}
                            </button>
                            <button
                                className={layout === 'table' ? 'active' : ''}
                                onClick={() => setLayout('table')}
                            >
                                {'📊 表格视图'}
                            </button>
                            <button
                                className={layout === 'flow' ? 'active' : ''}
                                onClick={() => setLayout('flow')}
                            >
                                {'🧾 单卡结算流水明细'}
                            </button>
                        </div>
                        <div className='PersonStats__search'>
                            <input
                                type='text'
                                placeholder='按姓名或组别过滤...'
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </div>
                        <RateChip
                            config={config}
                            rows={rows}
                            onApplyAll={applyRateToAll}
                        />
                        <div className='PersonStats__presets'>
                            <button
                                className={preset === 'month' ? 'active' : ''}
                                onClick={() => setPreset('month')}
                            >
                                本月
                            </button>
                            <button
                                className={preset === 'quarter' ? 'active' : ''}
                                onClick={() => setPreset('quarter')}
                            >
                                本季度
                            </button>
                            <button
                                className={preset === 'year' ? 'active' : ''}
                                onClick={() => setPreset('year')}
                            >
                                本年
                            </button>
                            <button
                                className={preset === 'custom' ? 'active' : ''}
                                onClick={() => setPreset('custom')}
                            >
                                自定义
                            </button>
                        </div>
                        <button
                            className={`PersonStats__advanced-toggle${showAdvanced ? ' active' : ''}`}
                            onClick={() => setShowAdvanced(!showAdvanced)}
                        >
                            {'高级筛选'}
                            {mode !== 'summary' && <span className='PersonStats__advanced-tag'>{PIVOT_LABELS[mode]}</span>}
                            {showAdvanced ? ' ▴' : ' ▾'}
                        </button>
                    </div>
                    {preset === 'custom' && (
                        <div className='PersonStats__custom'>
                            <input
                                type='date'
                                value={customStart}
                                onChange={(e) => setCustomStart(e.target.value)}
                            />
                            <span>至</span>
                            <input
                                type='date'
                                value={customEnd}
                                onChange={(e) => setCustomEnd(e.target.value)}
                            />
                        </div>
                    )}
                    {showAdvanced && (
                        <div className='PersonStats__advanced'>
                            <div className='PersonStats__pivots'>
                                <span className='PersonStats__pivots-label'>统计口径</span>
                                <button
                                    className={mode === 'summary' ? 'active' : ''}
                                    onClick={() => setMode('summary')}
                                >
                                    人员汇总
                                </button>
                                {PIVOT_ORDER.map((key) => (
                                    <button
                                        key={key}
                                        className={mode === key ? 'active' : ''}
                                        onClick={() => setMode(key)}
                                    >
                                        {PIVOT_LABELS[key]}
                                    </button>
                                ))}
                            </div>
                            {mode !== 'summary' && pivotDef && (
                                <div className='PersonStats__pivot-info'>
                                    {pivotDef.datePropertyId ? (
                                        <>
                                            {'本口径：'}
                                            <strong>{pivotDef.datePropertyName}</strong>
                                            {' 落在所选时间范围内'}
                                            {pivotDef.statusValues.length > 0 && (
                                                <>{'，且项目状态为 '}<strong>{pivotDef.statusValues.join('、')}</strong></>
                                            )}
                                            {' 的卡片，按完成度明细拆分到每位制作人。'}
                                        </>
                                    ) : (
                                        <>本 board 未找到日期属性「{pivotDef.datePropertyName}」，请在下方选择日期属性。</>
                                    )}
                                </div>
                            )}
                            {mode !== 'summary' && pivotDef && (
                                <PivotSettings
                                    board={board}
                                    config={config}
                                    pivotKey={mode}
                                    def={pivotDef}
                                    onSave={(patch) => saveConfig(withPivot(config, mode, patch))}
                                />
                            )}
                            <div className='PersonStats__advanced-foot'>
                                <label className='PersonStats__conv-toggle'>
                                    <input
                                        type='checkbox'
                                        checked={showConverted}
                                        onChange={(e) => setShowConverted(e.target.checked)}
                                    />
                                    显示内部折算
                                </label>
                                <button
                                    className='PersonStats__export'
                                    onClick={exportCsv}
                                >
                                    导出 CSV
                                </button>
                                <button
                                    className='PersonStats__help-toggle'
                                    onClick={() => setShowHelp(!showHelp)}
                                >
                                    {showHelp ? '收起说明' : '使用说明'}
                                </button>
                            </div>
                            {showHelp && (
                                <div className='PersonStats__help'>
                                    <p>统计口径决定「按什么规则选卡」：入选的卡仍按完成度明细把人天、金额拆分到每位制作人，KPI 与三种布局同步切换。</p>
                                    <ul>
                                        <li>人员汇总：按项目状态分桶——已安排的卡看创建日期，已完成/已结算的卡看完成日期，落在本期内的才计入</li>
                                        <li>当月申请结算：申请日期在本期内（不限状态）；当月实际完成：完成日期在本期内（无此属性时改用到期时间）；甲方当月结算：结算日期在本期内；申请且已付款：申请日期在本期内且状态为已付款</li>
                                        <li>口径名中的「当月」不是写死的，跟随页面顶部的时间范围（本月 / 本季度 / 本年 / 自定义）变化</li>
                                        <li>口径设置可更改每个口径的日期属性与状态包含（不勾选 = 全部状态），设置保存在本视图，所有人共用同一套</li>
                                        <li>四个口径之间互有包含关系（如「申请且已付款」是「当月申请结算」的子集），数字不可相加；入选了哪些卡，可在「单卡结算流水明细」中逐行核对</li>
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {layout === 'table' && (
                        <StatsTable
                            rows={filteredRows}
                            totals={totals}
                            convertedTotals={convertedTotals}
                            config={config}
                            showConverted={showConverted}
                            onSaveGroup={(userId, g) => saveConfig(withGroup(config, userId, g))}
                            onSaveRate={(userId, r) => saveConfig(withRate(config, userId, r))}
                        />
                    )}
                    {layout === 'cards' && (
                        <StatsCards
                            rows={filteredRows}
                            totals={totals}
                            convertedTotals={convertedTotals}
                            config={config}
                            showConverted={showConverted}
                        />
                    )}
                    {layout === 'flow' && (
                        <StatsFlow
                            flow={filteredFlow}
                            config={config}
                        />
                    )}

                    <div className='PersonStats__footnote'>
                        现代卡片核算模式：内部折算人天 = 各人金额 ÷ 各自内部比例（默认 ¥900/人天，可在表格/卡片中修改）；流水金额为个人份额（整卡金额 × 完成度占比），三布局口径一致、互相对账。
                    </div>
                </>
            )}
        </div>
    )
}

// --- shared bits -----------------------------------------------------------


// Display name: the full name the user set in their profile (firstname/lastname)
// first, then nickname, then username. Many users never set a nickname, and
// usernames are latin ids, so full name is the reliable human name.
// CJK names join as lastname+firstname with no space; others use a space.
const fullNameOf = (user: IUser | undefined, fallbackId: string): string => {
    if (!user) {
        return '未知用户'
    }
    const first = (user.firstname || '').trim()
    const last = (user.lastname || '').trim()
    if (first || last) {
        if (!first) {
            return last
        }
        if (!last) {
            return first
        }
        const cjk = /[\u3400-\u9fff]/
        return cjk.test(first + last) ? (last + first) : `${first} ${last}`
    }
    return user.nickname || user.username || fallbackId
}

const UserName = (props: {userId: string}): JSX.Element => {
    const user = useAppSelector(getUser(props.userId))
    return <>{fullNameOf(user, props.userId)}</>
}

const Avatar = (props: {userId: string, index: number}): JSX.Element => {
    const user = useAppSelector(getUser(props.userId))
    const name = fullNameOf(user, props.userId)
    const [failedFor, setFailedFor] = useState('')
    const picTs = user?.last_picture_update || 0
    const showPic = picTs > 0 && failedFor !== props.userId

    // The Mattermost API lives at the site root (origin + subpath). The
    // plugin's own baseURL points at /plugins/focalboard, so derive the root
    // from frontendBaseURL (subpath + '/boards') instead.
    const frontendBase = Utils.getFrontendBaseURL().replace(/boards$/, '').replace(/\/$/, '')
    const siteRoot = window.location.origin + (frontendBase ? `/${frontendBase}` : '')
    return (
        <span
            className='PersonStats__avatar'
            aria-hidden='true'
        >
            {showPic ? (
                <img
                    className='PersonStats__avatar-img'
                    src={`${siteRoot}/api/v4/users/${props.userId}/image?_=${picTs}`}
                    alt=''
                    onError={() => setFailedFor(props.userId)}
                />
            ) : name.slice(0, 1)}
        </span>
    )
}

const SegBar = (props: {scheduled: number, completed: number, settled: number}): JSX.Element => {
    const total = props.scheduled + props.completed + props.settled
    const pct = (v: number) => (total > 0 ? Math.min(100, (v / total) * 100) : 0)
    return (
        <div className='PersonStats__bar PersonStats__bar--big'>
            <span
                className='PersonStats__bar-seg PersonStats__bar-seg--scheduled'
                style={{width: `${pct(props.scheduled)}%`}}
            />
            <span
                className='PersonStats__bar-seg PersonStats__bar-seg--completed'
                style={{width: `${pct(props.completed)}%`}}
            />
            <span
                className='PersonStats__bar-seg PersonStats__bar-seg--settled'
                style={{width: `${pct(props.settled)}%`}}
            />
        </div>
    )
}

const GroupEditor = (props: {userId: string, config: PersonStatsViewConfig, onSave: (userId: string, group: string) => void}): JSX.Element => {
    const group = groupOf(props.config, props.userId)
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(group)
    useEffect(() => {
        setDraft(group)
    }, [group])

    if (!editing) {
        return (
            <button
                type='button'
                className='PersonStats__group-badge'
                title='点击编辑组别'
                onClick={() => setEditing(true)}
            >
                {group || '未分组'}
            </button>
        )
    }
    const commit = () => {
        setEditing(false)
        if (draft.trim() !== group) {
            props.onSave(props.userId, draft.trim())
        }
    }
    return (
        <input
            className='PersonStats__group-input'
            value={draft}
            autoFocus={true}
            placeholder='输入组别'
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    commit()
                }
                if (e.key === 'Escape') {
                    setEditing(false)
                }
            }}
        />
    )
}

const RateEditor = (props: {userId: string, config: PersonStatsViewConfig, onSave: (userId: string, rate: number) => void}): JSX.Element => {
    const rate = rateOf(props.config, props.userId)
    const [draft, setDraft] = useState(String(rate))
    useEffect(() => {
        setDraft(String(rate))
    }, [rate])
    const commit = () => {
        const v = parseFloat(draft)
        if (!isNaN(v) && v > 0 && v !== rate) {
            props.onSave(props.userId, v)
        } else {
            setDraft(String(rate))
        }
    }
    return (
        <input
            className='PersonStats__rate-input'
            type='number'
            min={1}
            value={draft}
            title='内部比例（元/人天），回车或失焦保存'
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    commit()
                }
            }}
        />
    )
}

// --- table layout ----------------------------------------------------------

type TableProps = {
    rows: PersonStatRow[]
    totals: PersonStatRow
    convertedTotals: {total: number, settled: number, completed: number}
    config: PersonStatsViewConfig
    showConverted: boolean
    onSaveGroup: (userId: string, group: string) => void
    onSaveRate: (userId: string, rate: number) => void
}

const StatsTable = (props: TableProps): JSX.Element => {
    const {rows, totals, convertedTotals, config, showConverted} = props
    return (
        <table className='PersonStats__table'>
            <thead>
                <tr className='PersonStats__groups'>
                    <th
                        colSpan={3}
                        className='PersonStats__group PersonStats__group--basic'
                    >
                        基本信息
                    </th>
                    <th
                        colSpan={4}
                        className='PersonStats__group PersonStats__group--progress'
                    >
                        工时进度
                    </th>
                    <th
                        colSpan={4}
                        className='PersonStats__group PersonStats__group--finance'
                    >
                        财务资金
                    </th>
                    <th
                        colSpan={showConverted ? 3 : 1}
                        className='PersonStats__group PersonStats__group--convert'
                    >
                        内部比例折算
                    </th>
                </tr>
                <tr>
                    <th>姓名</th>
                    <th>组别</th>
                    <th className='PersonStats__num'>项目数</th>
                    <th className='PersonStats__num PersonStats__divide-after'>总人天</th>
                    <th className='PersonStats__num'>已安排人天</th>
                    <th className='PersonStats__num'>已完成(未结算）人天</th>
                    <th className='PersonStats__num'>已结算人天</th>
                    <th className='PersonStats__num'>总金额</th>
                    <th className='PersonStats__num'>已安排金额</th>
                    <th className='PersonStats__num'>已完成(未结算）金额</th>
                    <th className='PersonStats__num PersonStats__divide-after'>已结算金额</th>
                    <th className='PersonStats__num'>内部比例（元/天）</th>
                    {showConverted && <th className='PersonStats__num'>内部折算人天</th>}
                    {showConverted && <th className='PersonStats__num'>已结折算人天</th>}
                </tr>
            </thead>
            <tbody>
                {rows.map((row, i) => (
                    <tr key={row.userId}>
                        <td>
                            <span className='PersonStats__person'>
                                <Avatar
                                    userId={row.userId}
                                    index={i}
                                />
                                <UserName userId={row.userId}/>
                            </span>
                        </td>
                        <td>
                            <GroupEditor
                                userId={row.userId}
                                config={config}
                                onSave={props.onSaveGroup}
                            />
                        </td>
                        <td className='PersonStats__num'>{row.projectCount}</td>
                        <td className='PersonStats__num PersonStats__divide-after'>
                            <div>{formatDays(row.totalDays)}</div>
                            <SegBar
                                scheduled={row.scheduledDays}
                                completed={row.completedDays}
                                settled={row.settledDays}
                            />
                        </td>
                        <td className='PersonStats__num PersonStats__num--scheduled'>{formatDays(row.scheduledDays)}</td>
                        <td className='PersonStats__num PersonStats__num--completed'>{formatDays(row.completedDays)}</td>
                        <td className='PersonStats__num PersonStats__num--settled'>{formatDays(row.settledDays)}</td>
                        <td className='PersonStats__num'>{formatAmount(row.totalAmount)}</td>
                        <td className='PersonStats__num'>{formatAmount(row.scheduledAmount)}</td>
                        <td className='PersonStats__num'>{formatAmount(row.completedAmount)}</td>
                        <td className='PersonStats__num PersonStats__divide-after'>{formatAmount(row.settledAmount)}</td>
                        <td className='PersonStats__num'>
                            <RateEditor
                                userId={row.userId}
                                config={config}
                                onSave={props.onSaveRate}
                            />
                        </td>
                        {showConverted && <td className='PersonStats__num PersonStats__num--conv'>{formatConverted(convertAmount(config, row.userId, row.totalAmount))}</td>}
                        {showConverted && <td className='PersonStats__num PersonStats__num--conv'>{formatConverted(convertAmount(config, row.userId, row.settledAmount))}</td>}
                    </tr>
                ))}
                {rows.length === 0 && (
                    <tr>
                        <td
                            colSpan={showConverted ? 14 : 12}
                            className='PersonStats__empty'
                        >
                            暂无数据
                        </td>
                    </tr>
                )}
            </tbody>
            {rows.length > 0 && (
                <tfoot>
                    <tr className='PersonStats__total'>
                        <td>全员汇总</td>
                        <td>{rows.length} 位制作人</td>
                        <td className='PersonStats__num'>{totals.projectCount}</td>
                        <td className='PersonStats__num PersonStats__divide-after'>{formatDays(totals.totalDays)}</td>
                        <td className='PersonStats__num'>{formatDays(totals.scheduledDays)}</td>
                        <td className='PersonStats__num'>{formatDays(totals.completedDays)}</td>
                        <td className='PersonStats__num'>{formatDays(totals.settledDays)}</td>
                        <td className='PersonStats__num'>{formatAmount(totals.totalAmount)}</td>
                        <td className='PersonStats__num'>{formatAmount(totals.scheduledAmount)}</td>
                        <td className='PersonStats__num'>{formatAmount(totals.completedAmount)}</td>
                        <td className='PersonStats__num PersonStats__divide-after'>{formatAmount(totals.settledAmount)}</td>
                        <td className='PersonStats__num'>—</td>
                        {showConverted && <td className='PersonStats__num'>{formatConverted(convertedTotals.total)}</td>}
                        {showConverted && <td className='PersonStats__num'>{formatConverted(convertedTotals.settled)}</td>}
                    </tr>
                </tfoot>
            )}
        </table>
    )
}

// --- cards layout ----------------------------------------------------------

type CardsProps = {
    rows: PersonStatRow[]
    totals: PersonStatRow
    convertedTotals: {total: number, settled: number, completed: number}
    config: PersonStatsViewConfig
    showConverted: boolean
}

const StatsCards = (props: CardsProps): JSX.Element => {
    const {rows, totals, convertedTotals, config, showConverted} = props
    return (
        <>
            <div className='PersonStats__cards'>
                {rows.map((row, i) => (
                    <div
                        key={row.userId}
                        className='PersonStats__card'
                    >
                        <div className='PersonStats__card-head'>
                            <Avatar
                                userId={row.userId}
                                index={i}
                            />
                            <div className='PersonStats__card-title'>
                                <span className='PersonStats__card-name'>
                                    <UserName userId={row.userId}/>
                                </span>
                            </div>
                            <span className='PersonStats__card-tasks'>{row.projectCount} 任务</span>
                        </div>
                        <div className='PersonStats__card-sub'>
                            参与 {row.projectCount} 个独立生产项目 · 核心制作人
                        </div>
                        <div className='PersonStats__card-section'>
                            <div className='PersonStats__card-section-head'>
                                <span>
                                    <span className='PersonStats__hours-icon'>{'🕐'}</span>
                                    {'工时人天进度'}
                                </span>
                                <span className='PersonStats__head-figs'>
                                    {showConverted && (
                                        <>
                                            <span className='PersonStats__head-fig'>{formatConverted(convertAmount(config, row.userId, row.totalAmount))}</span>
                                            {' 内部人天 / '}
                                        </>
                                    )}
                                    <span className='PersonStats__head-fig'>{formatDays(row.totalDays)}</span>
                                    {' 天总计'}
                                </span>
                            </div>
                            <SegBar
                                scheduled={row.scheduledDays}
                                completed={row.completedDays}
                                settled={row.settledDays}
                            />
                            <div className='PersonStats__card-trio'>
                                <div>
                                    <div className='PersonStats__trio-label'>已安排</div>
                                    <div className='PersonStats__num PersonStats__num--scheduled'>{formatDays(row.scheduledDays)} 天</div>
                                </div>
                                <div>
                                    <div className='PersonStats__trio-label'>已完成未结</div>
                                    <div className='PersonStats__num PersonStats__num--completed'>{formatDays(row.completedDays)} 天</div>
                                </div>
                                <div>
                                    <div className='PersonStats__trio-label'>已结算</div>
                                    <div className='PersonStats__num PersonStats__num--settled'>{formatDays(row.settledDays)} 天</div>
                                </div>
                            </div>
                        </div>
                        <div className='PersonStats__card-section'>
                            <div className='PersonStats__card-section-head'>
                                <span>
                                    <span className='PersonStats__finance-icon'>$</span>
                                    {'财务资金核算'}
                                </span>
                                <span className='PersonStats__num PersonStats__card-amount'>{formatAmount(row.totalAmount)}</span>
                            </div>
                            <div className='PersonStats__card-finance PersonStats__card-finance--row'>
                                <span>
                                    {'已结打款：'}
                                    <span className='PersonStats__fin-val PersonStats__fin-val--settled'>{formatAmount(row.settledAmount)}</span>
                                </span>
                                <span>
                                    {'待结存量：'}
                                    <span className='PersonStats__fin-val PersonStats__fin-val--pending'>{formatAmount(row.completedAmount)}</span>
                                </span>
                            </div>
                        </div>
                    </div>
                ))}
                {rows.length === 0 && <div className='PersonStats__empty'>暂无数据</div>}
            </div>
            {rows.length > 0 && (
                <div className='PersonStats__summary-band'>
                    <div className='PersonStats__summary-block'>
                        <div className='PersonStats__summary-title'>全员汇总合计</div>
                        <div className='PersonStats__summary-sub'>{rows.length} 位制作人 · 累计 {totals.projectCount} 项任务</div>
                    </div>
                    <div className='PersonStats__summary-block'>
                        <div className='PersonStats__trio-label'>标准总核算人天</div>
                        <div className='PersonStats__num PersonStats__summary-big'>{formatDays(totals.totalDays)} 天</div>
                        <div className='PersonStats__summary-sub'>已安排：{formatDays(totals.scheduledDays)} 天 ｜ 已结：{formatDays(totals.settledDays)} 天</div>
                    </div>
                    <div className='PersonStats__summary-block'>
                        <div className='PersonStats__trio-label'>累计总金额（元）</div>
                        <div className='PersonStats__num PersonStats__summary-big'>{formatAmount(totals.totalAmount)}</div>
                        <div className='PersonStats__summary-sub'>已安排：{formatAmount(totals.scheduledAmount)} ｜ 已完成未结：{formatAmount(totals.completedAmount)} ｜ 已结打款：{formatAmount(totals.settledAmount)}</div>
                    </div>
                    {showConverted && (
                        <div className='PersonStats__summary-block'>
                            <div className='PersonStats__trio-label'>总内部折算人天</div>
                            <div className='PersonStats__num PersonStats__summary-big PersonStats__num--conv'>{formatConverted(convertedTotals.total)} 总内部人天</div>
                            <div className='PersonStats__summary-sub'>内部已结算：{formatConverted(convertedTotals.settled)} 天 ｜ 内部待结：{formatConverted(convertedTotals.completed)} 天</div>
                        </div>
                    )}
                </div>
            )}
        </>
    )
}

// --- flow layout -----------------------------------------------------------

const StatsFlow = (props: {flow: PersonFlowRow[], config: PersonStatsViewConfig}): JSX.Element => {
    const {flow, config} = props
    const totalAmount = flow.reduce((acc, f) => acc + f.amount, 0)
    const totalConverted = flow.reduce((acc, f) => acc + convertAmount(config, f.userId, f.amount), 0)
    return (
        <>
            <div className='PersonStats__flow-note'>
                流水口径：每行 = 一张卡 × 一位制作人的份额（整卡金额 × 完成度占比），折算 = 份额金额 ÷ 该人内部比例。共 {flow.length} 项流水。
            </div>
            <table className='PersonStats__table PersonStats__flow-table'>
                <thead>
                    <tr>
                        <th>制作人</th>
                        <th>关联卡片任务</th>
                        <th>状态</th>
                        <th>实际单价</th>
                        <th className='PersonStats__num'>占比</th>
                        <th className='PersonStats__num'>人天（份额）</th>
                        <th className='PersonStats__num'>实际金额（元）</th>
                        <th className='PersonStats__num'>内部折算人天</th>
                    </tr>
                </thead>
                <tbody>
                    {flow.map((f, i) => (
                        <tr key={`${f.cardId}-${f.userId}`}>
                            <td>
                                <span className='PersonStats__person'>
                                    <Avatar
                                        userId={f.userId}
                                        index={i}
                                    />
                                    <UserName userId={f.userId}/>
                                </span>
                            </td>
                            <td className='PersonStats__flow-title'>{f.cardTitle}</td>
                            <td>
                                <span className={`PersonStats__cat PersonStats__cat--${f.category}`}>
                                    {CATEGORY_LABEL[f.category] || f.statusLabel}
                                </span>
                            </td>
                            <td>
                                {f.unitPriceLabel ? <span className='PersonStats__price-badge'>{f.unitPriceLabel}</span> : '—'}
                            </td>
                            <td className='PersonStats__num'>{f.share}%</td>
                            <td className='PersonStats__num'>{formatDays(f.days)}</td>
                            <td className='PersonStats__num'>{formatAmount(f.amount)}</td>
                            <td className='PersonStats__num PersonStats__num--conv'>{formatConverted(convertAmount(config, f.userId, f.amount))} 天</td>
                        </tr>
                    ))}
                    {flow.length === 0 && (
                        <tr>
                            <td
                                colSpan={8}
                                className='PersonStats__empty'
                            >
                                暂无流水
                            </td>
                        </tr>
                    )}
                </tbody>
                {flow.length > 0 && (
                    <tfoot>
                        <tr className='PersonStats__total'>
                            <td colSpan={6}>总计流水汇总</td>
                            <td className='PersonStats__num'>总计 {formatAmount(totalAmount)}</td>
                            <td className='PersonStats__num'>总内部人天：{formatConverted(totalConverted)} 天</td>
                        </tr>
                    </tfoot>
                )}
            </table>
        </>
    )
}

// --- toolbar internal-rate chip ----------------------------------------------

// Shows the internal conversion rate as a toolbar capsule. Clicking
// opens a small popover that applies one rate to every producer at
// once; per-person fine-tuning stays in the table/cards inputs.
const RateChip = (props: {
    config: PersonStatsViewConfig,
    rows: PersonStatRow[],
    onApplyAll: (rate: number) => void,
}): JSX.Element => {
    const [open, setOpen] = useState(false)
    const rates = Array.from(new Set(props.rows.map((r) => rateOf(props.config, r.userId))))
    const uniform = rates.length === 1 ? rates[0] : undefined
    const [draft, setDraft] = useState('')

    const toggle = () => {
        setDraft(String(uniform ?? DEFAULT_INTERNAL_RATE))
        setOpen(!open)
    }
    const apply = () => {
        const v = parseFloat(draft)
        if (!isNaN(v) && v > 0) {
            props.onApplyAll(v)
        }
        setOpen(false)
    }

    return (
        <div className='PersonStats__ratechip'>
            <button
                className={`PersonStats__ratechip-btn${open ? ' active' : ''}`}
                onClick={toggle}
            >
                {uniform ? `🧮 内部比例（¥${uniform}/天）` : '🧮 内部比例（多档）'}
            </button>
            {open && (
                <div className='PersonStats__ratechip-pop'>
                    <label className='PersonStats__ratechip-label'>统一内部比例（元/天）</label>
                    <div className='PersonStats__ratechip-row'>
                        <input
                            type='number'
                            min={1}
                            value={draft}
                            autoFocus={true}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    apply()
                                }
                            }}
                        />
                        <button onClick={apply}>应用到全部制作人</button>
                    </div>
                    <div className='PersonStats__ratechip-note'>每位制作人的比例也可单独在表格 / 卡片中修改。</div>
                </div>
            )}
        </div>
    )
}

// --- pivot settings ----------------------------------------------------------

const PivotSettings = (props: {
    board: Board,
    config: PersonStatsViewConfig,
    pivotKey: PivotKey,
    def: ResolvedPivot,
    onSave: (patch: PersonStatsPivotConfig) => void,
}): JSX.Element => {
    const dateProps = props.board.cardProperties.filter((p) => p.type === 'date')
    const statusTemplate = props.board.cardProperties.find((p) => p.name === '项目状态')
    const statusOptions = statusTemplate?.options || []

    const toggleStatus = (value: string) => {
        const cur = props.def.statusValues
        const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
        props.onSave({statusValues: next})
    }

    return (
        <div className='PersonStats__pivot-settings'>
            <label className='PersonStats__pivot-field'>
                {'日期属性 '}
                <select
                    value={props.def.datePropertyId || ''}
                    onChange={(e) => props.onSave({datePropertyId: e.target.value || undefined})}
                >
                    <option value=''>（未选择）</option>
                    {dateProps.map((p) => (
                        <option
                            key={p.id}
                            value={p.id}
                        >
                            {p.name}
                        </option>
                    ))}
                </select>
            </label>
            <div className='PersonStats__pivot-field'>
                <span>项目状态包含（不勾选 = 全部状态）：</span>
                <span className='PersonStats__pivot-statuses'>
                    {statusOptions.map((o) => (
                        <label key={o.id}>
                            <input
                                type='checkbox'
                                checked={props.def.statusValues.includes(o.value)}
                                onChange={() => toggleStatus(o.value)}
                            />
                            {o.value}
                        </label>
                    ))}
                </span>
            </div>
        </div>
    )
}

export default PersonStats
