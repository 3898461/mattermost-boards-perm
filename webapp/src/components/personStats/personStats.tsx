// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useRef, useState} from 'react'

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
    collectUnclassified,
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

type SortDir = 'asc' | 'desc'
type SortState<K extends string> = {key: K, dir: SortDir} | null

// Clickable sort header cell shared by the stats tables. First click on a
// column applies its natural direction (names ascending, numbers
// descending); clicking the active column flips the direction.
function SortTh<K extends string>(props: {
    label: string
    sortKey: K
    sort: SortState<K>
    onSort: (key: K, naturalDir: SortDir) => void
    naturalDir: SortDir
    className?: string
    resizer?: React.ReactNode
}): JSX.Element {
    const active = props.sort?.key === props.sortKey
    return (
        <th
            className={`${props.className || ''} PersonStats__sortable`.trim()}
            onClick={() => props.onSort(props.sortKey, props.naturalDir)}
            title='点击排序'
        >
            {props.label}
            {active && <span className='PersonStats__sort-arrow'>{props.sort?.dir === 'asc' ? '↑' : '↓'}</span>}
            {props.resizer}
        </th>
    )
}

function nextSort<K extends string>(sort: SortState<K>, key: K, naturalDir: SortDir): SortState<K> {
    if (!sort || sort.key !== key) {
        return {key, dir: naturalDir}
    }
    return {key, dir: sort.dir === 'asc' ? 'desc' : 'asc'}
}

function compareValues(a: string | number, b: string | number): number {
    if (typeof a === 'number' && typeof b === 'number') {
        return a - b
    }
    return String(a).localeCompare(String(b), 'zh-CN')
}

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

    // Amount privacy switch (2026-10-22): real amounts and converted
    // internal days are masked ("***") by default. Clicking the eye
    // reveals them for 60 seconds, then they mask themselves again;
    // switching to another view/board also resets to masked (fresh
    // state per view, and the timer below never survives navigation).
    const [revealAmounts, setRevealAmounts] = useState(false)
    useEffect(() => {
        setRevealAmounts(false)
    }, [props.activeView.id])
    useEffect(() => {
        if (!revealAmounts) {
            return undefined
        }
        const t = setTimeout(() => setRevealAmounts(false), 60000)
        return () => clearTimeout(t)
    }, [revealAmounts])
    const fmtAmount = (v: number): string => (revealAmounts ? formatAmount(v) : '***')
    const fmtConverted = (v: number): string => (revealAmounts ? formatConverted(v) : '***')

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

    // Smoke alarm for status-vocabulary drift (summary mode only): cards
    // whose status matches no bucket are silently dropped from every
    // number above, so surface their count instead of letting totals
    // shrink without a trace.
    const unclassified = useMemo(
        () => (mode === 'summary' && hasRequiredProps ? collectUnclassified(board, props.cards) : {count: 0, statuses: [] as string[]}),
        [mode, hasRequiredProps, board, props.cards],
    )

    // Lane order of the 项目状态 options, for sorting flow rows by status
    // the way the board itself flows (not alphabetically).
    const statusOrder = useMemo(() => {
        const map = new Map<string, number>()
        const tpl = board.cardProperties.find((p) => p.name === '项目状态')
        tpl?.options.forEach((o, i) => map.set(o.value.trim(), i))
        return map
    }, [board])

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
            actualHours: 0, quotedPairedDays: 0, effCardCount: 0,
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
            t.actualHours += r.actualHours
            t.quotedPairedDays += r.quotedPairedDays
            t.effCardCount += r.effCardCount
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
        const header = ['制作人', '项目数', '总人天', '已安排人天', '已完成未结人天', '已结算人天', '实际耗时(天)', '对比报价(天)', '效率', '差值(天)', '总金额', '已安排金额', '已完成未结金额', '已结算金额', '内部比例(元/天)', '内部折算人天', '已结折算人天']
        const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`
        const lines = [header.map(esc).join(',')]
        for (const r of filteredRows) {
            lines.push([
                displayNameOf(r.userId), r.projectCount,
                formatDays(r.totalDays), formatDays(r.scheduledDays), formatDays(r.completedDays), formatDays(r.settledDays),
                r.effCardCount > 0 ? formatDays(r.actualHours) : '', r.effCardCount > 0 ? formatDays(r.quotedPairedDays) : '', effOf(r) === null ? '' : effOf(r)!.toFixed(2), r.effCardCount > 0 ? formatDays(r.quotedPairedDays - r.actualHours) : '',
                revealAmounts ? r.totalAmount.toFixed(2) : '***', revealAmounts ? r.scheduledAmount.toFixed(2) : '***', revealAmounts ? r.completedAmount.toFixed(2) : '***', revealAmounts ? r.settledAmount.toFixed(2) : '***',
                rateOf(config, r.userId), fmtConverted(convertAmount(config, r.userId, r.totalAmount)), fmtConverted(convertAmount(config, r.userId, r.settledAmount)),
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
                                <div className='PersonStats__kpi-value PersonStats__kpi-value--conv'>{fmtConverted(convertedTotals.total)} <span className='PersonStats__kpi-unit'>内部人天</span></div>
                                <div className='PersonStats__kpi-sub'>已结：{fmtConverted(convertedTotals.settled)} 天 ｜ 待结：{fmtConverted(convertedTotals.completed)} 天</div>
                            </div>
                        )}
                        <div className='PersonStats__kpi'>
                            <div className='PersonStats__kpi-label'>累计总金额（元）</div>
                            <div className='PersonStats__kpi-value PersonStats__kpi-value--amount'>{fmtAmount(totals.totalAmount)}</div>
                            <div className='PersonStats__kpi-sub'>已结累计打款：{fmtAmount(totals.settledAmount)}</div>
                        </div>
                    </div>

                    {unclassified.count > 0 && (
                        <div className='PersonStats__warning'>
                            {'本期有 '}
                            {unclassified.count}
                            {' 张卡片的状态未归类，未计入统计（'}
                            {unclassified.statuses.map((st) => (st === '' ? '未设置状态' : st)).join('、')}
                            {'）。如新增或改名了泳道，请联系管理员更新统计口径。'}
                        </div>
                    )}

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
                        <button
                            className={`PersonStats__eye-toggle${revealAmounts ? ' active' : ''}`}
                            onClick={() => setRevealAmounts(!revealAmounts)}
                            title={revealAmounts ? '金额显示中，60 秒后自动隐藏；点击立即隐藏' : '显示真实金额与内部折算人天（60 秒后自动隐藏）'}
                        >
                            {revealAmounts ? '🙈 金额显示中' : '👁 显示金额'}
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
                                        <li>金额与内部折算人天默认以 *** 隐藏：点工具栏「👁 显示金额」临时显示，60 秒后自动隐藏，切到其他视图也会恢复隐藏；CSV 导出跟随当前显示状态</li>
                                        <li>实际效率（仅表格视图）：只统计已完成/已结算、且在卡片里填过实际耗时的卡，成对计算——实际耗时 = 实际耗时明细求和，对比报价 = 同批卡的人天 × 完成度占比，效率 = 对比报价 ÷ 实际耗时（大于 1 比报价快，小于 1 超时），差值 = 对比报价 − 实际耗时；实际耗时按天填（1 天 = 8 小时），可填 1.5 这样的小数</li>
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {layout === 'table' && (
                        <StatsTable
                            nameOf={displayNameOf}
                            rows={filteredRows}
                            totals={totals}
                            convertedTotals={convertedTotals}
                            config={config}
                            showConverted={showConverted}
                            fmtAmount={fmtAmount}
                            fmtConverted={fmtConverted}
                            storageKey={`personStats.colWidths.${board.id}.${props.activeView.id}`}
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
                            fmtAmount={fmtAmount}
                            fmtConverted={fmtConverted}
                        />
                    )}
                    {layout === 'flow' && (
                        <StatsFlow
                            flow={filteredFlow}
                            config={config}
                            nameOf={displayNameOf}
                            statusOrder={statusOrder}
                            fmtAmount={fmtAmount}
                            fmtConverted={fmtConverted}
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
    fmtAmount: (v: number) => string
    fmtConverted: (v: number) => string
    nameOf: (userId: string) => string
    storageKey: string
    onSaveGroup: (userId: string, group: string) => void
    onSaveRate: (userId: string, rate: number) => void
}

type TableSortKey = 'name' | 'group' | 'projects' | 'totalDays' | 'scheduledDays' | 'completedDays' | 'settledDays' | 'actualHours' | 'quotedPaired' | 'efficiency' | 'effDiff' | 'totalAmount' | 'scheduledAmount' | 'completedAmount' | 'settledAmount' | 'rate' | 'converted' | 'settledConverted'

// Render order of the table's columns (matches the header/body cells).
const TABLE_COLUMN_KEYS: TableSortKey[] = ['name', 'projects', 'totalDays', 'scheduledDays', 'completedDays', 'settledDays', 'actualHours', 'quotedPaired', 'efficiency', 'effDiff', 'totalAmount', 'scheduledAmount', 'completedAmount', 'settledAmount', 'rate', 'converted', 'settledConverted']

// Efficiency of a row: quoted paired days over recorded actual
// hours. Null when the person has no covered card (or zero recorded
// hours), rendered as "—".
const effOf = (r: PersonStatRow): number | null => (r.effCardCount > 0 && r.actualHours > 0 ? r.quotedPairedDays / r.actualHours : null)

const StatsTable = (props: TableProps): JSX.Element => {
    const {rows, totals, convertedTotals, config, showConverted, fmtAmount, fmtConverted} = props
    const [sort, setSort] = useState<SortState<TableSortKey>>(null)
    const onSort = (key: TableSortKey, naturalDir: SortDir) => setSort((cur) => nextSort(cur, key, naturalDir))
    const sortValue = (r: PersonStatRow, key: TableSortKey): string | number => {
        switch (key) {
        case 'name': return props.nameOf(r.userId)
        case 'group': return groupOf(config, r.userId)
        case 'projects': return r.projectCount
        case 'rate': return rateOf(config, r.userId)
        case 'converted': return convertAmount(config, r.userId, r.totalAmount)
        case 'settledConverted': return convertAmount(config, r.userId, r.settledAmount)
        case 'quotedPaired': return r.quotedPairedDays
        case 'efficiency': return effOf(r) ?? -1
        case 'effDiff': return r.quotedPairedDays - r.actualHours
        default: return r[key]
        }
    }
    // The four 实际效率 cells, shared by body rows and the totals row.
    const effCells = (r: PersonStatRow): JSX.Element => {
        const eff = effOf(r)
        const diff = r.quotedPairedDays - r.actualHours
        return (
            <>
                <td className='PersonStats__num'>
                    {r.effCardCount > 0 ? (
                        <>
                            {formatDays(r.actualHours)}
                            <div className='PersonStats__eff-note'>{r.effCardCount} 卡</div>
                        </>
                    ) : '—'}
                </td>
                <td className='PersonStats__num'>{r.effCardCount > 0 ? formatDays(r.quotedPairedDays) : '—'}</td>
                <td className='PersonStats__num'>
                    {eff === null ? '—' : <span className={eff >= 1 ? 'PersonStats__eff-good' : 'PersonStats__eff-bad'}>{eff.toFixed(2)}×</span>}
                </td>
                <td className='PersonStats__num PersonStats__divide-after'>
                    {r.effCardCount > 0 ? (
                        <span className={diff > 0 ? 'PersonStats__eff-good' : (diff < 0 ? 'PersonStats__eff-bad' : '')}>
                            {diff > 0 ? '+' : ''}{formatDays(diff)}
                        </span>
                    ) : '—'}
                </td>
            </>
        )
    }
    const sortedRows = useMemo(() => {
        if (!sort) {
            return rows
        }
        const mul = sort.dir === 'asc' ? 1 : -1
        return [...rows].sort((a, b) => {
            const c = compareValues(sortValue(a, sort.key), sortValue(b, sort.key))
            return c !== 0 ? c * mul : props.nameOf(a.userId).localeCompare(props.nameOf(b.userId), 'zh-CN')
        })
    }, [rows, sort, config])

    // --- column widths (2026-10-23): drag the right edge of a header
    // to resize, double-click it (or the 自适应 button) to fit content,
    // 恢复默认 clears. Widths persist per browser in localStorage —
    // a personal display preference, never written to the view.
    const visibleColumns = TABLE_COLUMN_KEYS.filter((k) => showConverted || (k !== 'converted' && k !== 'settledConverted'))
    const tableRef = useRef<HTMLTableElement>(null)
    const justResizedAt = useRef(0)
    const readWidths = (): Record<string, number> => {
        try {
            const parsed = JSON.parse(localStorage.getItem(props.storageKey) || '{}')
            return parsed && typeof parsed === 'object' ? parsed : {}
        } catch {
            return {}
        }
    }
    const [colWidths, setColWidths] = useState<Record<string, number>>(readWidths)
    useEffect(() => {
        setColWidths(readWidths())
    }, [props.storageKey])
    useEffect(() => {
        try {
            localStorage.setItem(props.storageKey, JSON.stringify(colWidths))
        } catch {
            // Storage unavailable (private mode): widths just don't stick.
        }
    }, [colWidths, props.storageKey])
    const guardedOnSort = (key: TableSortKey, naturalDir: SortDir) => {
        if (Date.now() - justResizedAt.current < 200) {
            return
        }
        onSort(key, naturalDir)
    }
    const startResize = (colKey: string) => (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const th = (e.currentTarget as HTMLElement).closest('th')
        const table = tableRef.current

        // Auto table layout treats a lone column width as a hint and
        // absorbs the drag into its neighbours, so the first drag
        // first pins EVERY column to its currently rendered width;
        // from then on each column has an explicit width and (with
        // the --fixed layout below) drags move exactly 1:1.
        let base = colWidths
        if (table && visibleColumns.some((k) => !colWidths[k])) {
            const headerRow = table.tHead && table.tHead.rows[1]
            if (headerRow) {
                base = {...colWidths}
                visibleColumns.forEach((k, i) => {
                    if (!base[k]) {
                        const cell = headerRow.cells[i]
                        if (cell) {
                            base[k] = cell.offsetWidth
                        }
                    }
                })
                setColWidths(base)
            }
        }
        const startWidth = base[colKey] || (th ? th.offsetWidth : 100)
        const startX = e.clientX
        if (table) {
            table.classList.add('PersonStats__table--resizing')
        }
        const onMove = (ev: MouseEvent) => {
            setColWidths((prev) => ({...prev, [colKey]: Math.max(64, Math.round(startWidth + ev.clientX - startX))}))
        }
        const onUp = () => {
            document.removeEventListener('mousemove', onMove)
            document.removeEventListener('mouseup', onUp)
            if (table) {
                table.classList.remove('PersonStats__table--resizing')
            }
            justResizedAt.current = Date.now()
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
    }
    const measureWidths = (only?: string): Record<string, number> => {
        const table = tableRef.current
        if (!table) {
            return colWidths
        }
        table.classList.add('PersonStats__table--measuring')
        const next = {...colWidths}
        visibleColumns.forEach((k, idx) => {
            if (only && only !== k) {
                return
            }
            let max = 0
            for (const row of Array.from(table.rows)) {
                if (row.cells.length !== visibleColumns.length) {
                    continue
                }
                const cell = row.cells[idx]
                if (cell) {
                    max = Math.max(max, cell.offsetWidth, cell.scrollWidth)
                }
            }
            if (max > 0) {
                next[k] = max + 2
            }
        })
        table.classList.remove('PersonStats__table--measuring')
        return next
    }
    const resizerFor = (colKey: string): JSX.Element => (
        <span
            className='PersonStats__col-resizer'
            onMouseDown={startResize(colKey)}
            onDoubleClick={(e) => {
                e.stopPropagation()
                setColWidths(measureWidths(colKey))
            }}
            onClick={(e) => e.stopPropagation()}
        />
    )
    const colWidthFor = (k: string): number | undefined => colWidths[k] || (k === 'name' ? 148 : undefined)

    return (
        <>
            <div className='PersonStats__table-tools'>
                <button onClick={() => setColWidths(measureWidths())}>自适应列宽</button>
                <button onClick={() => setColWidths({})}>恢复默认</button>
            </div>
            <div className='PersonStats__table-scroll'>
                <table
                    className={`PersonStats__table${Object.keys(colWidths).length > 0 ? ' PersonStats__table--fixed' : ''}`}
                    ref={tableRef}
                >
                    <colgroup>
                        {visibleColumns.map((k) => (
                            <col
                                key={k}
                                style={{width: colWidthFor(k) ? `${colWidthFor(k)}px` : undefined}}
                            />
                        ))}
                    </colgroup>
                    <thead>
                        <tr className='PersonStats__groups'>
                            <th
                                colSpan={2}
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
                                className='PersonStats__group PersonStats__group--efficiency'
                            >
                        实际效率
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
                            <SortTh label='姓名' sortKey='name' resizer={resizerFor('name')} sort={sort} onSort={guardedOnSort} naturalDir='asc'/>
                            <SortTh label='项目数' sortKey='projects' resizer={resizerFor('projects')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='总人天' sortKey='totalDays' resizer={resizerFor('totalDays')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num PersonStats__divide-after'/>
                            <SortTh label='已安排人天' sortKey='scheduledDays' resizer={resizerFor('scheduledDays')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='已完成(未结算）人天' sortKey='completedDays' resizer={resizerFor('completedDays')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='已结算人天' sortKey='settledDays' resizer={resizerFor('settledDays')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='实际耗时（天）' sortKey='actualHours' resizer={resizerFor('actualHours')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='对比报价（天）' sortKey='quotedPaired' resizer={resizerFor('quotedPaired')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='效率' sortKey='efficiency' resizer={resizerFor('efficiency')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='差值（天）' sortKey='effDiff' resizer={resizerFor('effDiff')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='总金额' sortKey='totalAmount' resizer={resizerFor('totalAmount')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='已安排金额' sortKey='scheduledAmount' resizer={resizerFor('scheduledAmount')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='已完成(未结算）金额' sortKey='completedAmount' resizer={resizerFor('completedAmount')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            <SortTh label='已结算金额' sortKey='settledAmount' resizer={resizerFor('settledAmount')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num PersonStats__divide-after'/>
                            <SortTh label='内部比例（元/天）' sortKey='rate' resizer={resizerFor('rate')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>
                            {showConverted && <SortTh label='内部折算人天' sortKey='converted' resizer={resizerFor('converted')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>}
                            {showConverted && <SortTh label='已结折算人天' sortKey='settledConverted' resizer={resizerFor('settledConverted')} sort={sort} onSort={guardedOnSort} naturalDir='desc' className='PersonStats__num'/>}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedRows.map((row, i) => (
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
                                {effCells(row)}
                                <td className='PersonStats__num PersonStats__amt-total'>{fmtAmount(row.totalAmount)}</td>
                                <td className='PersonStats__num PersonStats__amt-scheduled'>{fmtAmount(row.scheduledAmount)}</td>
                                <td className='PersonStats__num PersonStats__amt-completed'>{fmtAmount(row.completedAmount)}</td>
                                <td className='PersonStats__num PersonStats__amt-settled PersonStats__divide-after'>{fmtAmount(row.settledAmount)}</td>
                                <td className='PersonStats__num'>
                                    <RateEditor
                                        userId={row.userId}
                                        config={config}
                                        onSave={props.onSaveRate}
                                    />
                                </td>
                                {showConverted && <td className='PersonStats__num PersonStats__num--conv'>{fmtConverted(convertAmount(config, row.userId, row.totalAmount))}</td>}
                                {showConverted && <td className='PersonStats__num PersonStats__num--conv'>{fmtConverted(convertAmount(config, row.userId, row.settledAmount))}</td>}
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr>
                                <td
                                    colSpan={showConverted ? 17 : 15}
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
                                <td>全员汇总（{rows.length} 位制作人）</td>
                                <td className='PersonStats__num'>{totals.projectCount}</td>
                                <td className='PersonStats__num PersonStats__divide-after'>{formatDays(totals.totalDays)}</td>
                                <td className='PersonStats__num'>{formatDays(totals.scheduledDays)}</td>
                                <td className='PersonStats__num'>{formatDays(totals.completedDays)}</td>
                                <td className='PersonStats__num'>{formatDays(totals.settledDays)}</td>
                                {effCells(totals)}
                                <td className='PersonStats__num PersonStats__amt-total'>{fmtAmount(totals.totalAmount)}</td>
                                <td className='PersonStats__num PersonStats__amt-scheduled'>{fmtAmount(totals.scheduledAmount)}</td>
                                <td className='PersonStats__num PersonStats__amt-completed'>{fmtAmount(totals.completedAmount)}</td>
                                <td className='PersonStats__num PersonStats__amt-settled PersonStats__divide-after'>{fmtAmount(totals.settledAmount)}</td>
                                <td className='PersonStats__num'>—</td>
                                {showConverted && <td className='PersonStats__num'>{fmtConverted(convertedTotals.total)}</td>}
                                {showConverted && <td className='PersonStats__num'>{fmtConverted(convertedTotals.settled)}</td>}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </>
    )
}

// --- cards layout ----------------------------------------------------------

type CardsProps = {
    rows: PersonStatRow[]
    totals: PersonStatRow
    convertedTotals: {total: number, settled: number, completed: number}
    config: PersonStatsViewConfig
    showConverted: boolean
    fmtAmount: (v: number) => string
    fmtConverted: (v: number) => string
}

type CardSortKey = 'days' | 'projects' | 'amount'

const StatsCards = (props: CardsProps): JSX.Element => {
    const {rows, totals, convertedTotals, config, showConverted, fmtAmount, fmtConverted} = props
    const [sort, setSort] = useState<SortState<CardSortKey>>(null)
    const onSort = (key: CardSortKey) => setSort((cur) => nextSort(cur, key, 'desc'))
    const sortedRows = useMemo(() => {
        if (!sort) {
            return rows
        }
        const mul = sort.dir === 'asc' ? 1 : -1
        const valueOf = (r: PersonStatRow): number => {
            if (sort.key === 'days') {
                return r.totalDays
            }
            if (sort.key === 'projects') {
                return r.projectCount
            }
            return r.totalAmount
        }
        return [...rows].sort((a, b) => {
            const c = valueOf(a) - valueOf(b)
            return c !== 0 ? c * mul : b.totalDays - a.totalDays
        })
    }, [rows, sort])
    const sortBtn = (key: CardSortKey, label: string) => (
        <button
            className={sort?.key === key ? 'active' : ''}
            onClick={() => onSort(key)}
        >
            {label}
            {sort?.key === key && <span className='PersonStats__sort-arrow'>{sort.dir === 'asc' ? '↑' : '↓'}</span>}
        </button>
    )
    return (
        <>
            <div className='PersonStats__cards-sort'>
                <span className='PersonStats__cards-sort-label'>排序</span>
                {sortBtn('days', '人天')}
                {sortBtn('projects', '任务数')}
                {sortBtn('amount', '金额')}
            </div>
            <div className='PersonStats__cards'>
                {sortedRows.map((row, i) => (
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
                                            <span className='PersonStats__head-fig'>{fmtConverted(convertAmount(config, row.userId, row.totalAmount))}</span>
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
                                <span className='PersonStats__num PersonStats__card-amount'>{fmtAmount(row.totalAmount)}</span>
                            </div>
                            <div className='PersonStats__card-finance PersonStats__card-finance--row'>
                                <span>
                                    {'已结打款：'}
                                    <span className='PersonStats__fin-val PersonStats__fin-val--settled'>{fmtAmount(row.settledAmount)}</span>
                                </span>
                                <span>
                                    {'待结存量：'}
                                    <span className='PersonStats__fin-val PersonStats__fin-val--pending'>{fmtAmount(row.completedAmount)}</span>
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
                        <div className='PersonStats__num PersonStats__summary-big'>{fmtAmount(totals.totalAmount)}</div>
                        <div className='PersonStats__summary-sub'>已安排：{fmtAmount(totals.scheduledAmount)} ｜ 已完成未结：{fmtAmount(totals.completedAmount)} ｜ 已结打款：{fmtAmount(totals.settledAmount)}</div>
                    </div>
                    {showConverted && (
                        <div className='PersonStats__summary-block'>
                            <div className='PersonStats__trio-label'>总内部折算人天</div>
                            <div className='PersonStats__num PersonStats__summary-big PersonStats__num--conv'>{fmtConverted(convertedTotals.total)} 总内部人天</div>
                            <div className='PersonStats__summary-sub'>内部已结算：{fmtConverted(convertedTotals.settled)} 天 ｜ 内部待结：{fmtConverted(convertedTotals.completed)} 天</div>
                        </div>
                    )}
                </div>
            )}
        </>
    )
}

// --- flow layout -----------------------------------------------------------

type FlowSortKey = 'user' | 'title' | 'status' | 'price' | 'share' | 'days' | 'amount' | 'converted'

const CATEGORY_RANK: Record<string, number> = {scheduled: 0, completed: 1, settled: 2}

const StatsFlow = (props: {flow: PersonFlowRow[], config: PersonStatsViewConfig, nameOf: (userId: string) => string, statusOrder: Map<string, number>, fmtAmount: (v: number) => string, fmtConverted: (v: number) => string}): JSX.Element => {
    const {flow, config, fmtAmount, fmtConverted} = props
    const [sort, setSort] = useState<SortState<FlowSortKey>>({key: 'amount', dir: 'desc'})
    const onSort = (key: FlowSortKey, naturalDir: SortDir) => setSort((cur) => nextSort(cur, key, naturalDir))
    const sortValue = (f: PersonFlowRow, key: FlowSortKey): string | number => {
        switch (key) {
        case 'user': return props.nameOf(f.userId)
        case 'title': return f.cardTitle
        case 'status': return (CATEGORY_RANK[f.category] ?? 3) * 10000 + (props.statusOrder.get(f.statusLabel) ?? 9999)
        case 'price': return f.unitPriceLabel
        case 'share': return f.share
        case 'days': return f.days
        case 'converted': return convertAmount(config, f.userId, f.amount)
        default: return f.amount
        }
    }
    const sortedFlow = useMemo(() => {
        if (!sort) {
            return flow
        }
        const mul = sort.dir === 'asc' ? 1 : -1
        return [...flow].sort((a, b) => {
            const c = compareValues(sortValue(a, sort.key), sortValue(b, sort.key))
            return c !== 0 ? c * mul : b.amount - a.amount
        })
    }, [flow, sort, config, props.statusOrder])
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
                        <SortTh label='制作人' sortKey='user' sort={sort} onSort={onSort} naturalDir='asc'/>
                        <SortTh label='关联卡片任务' sortKey='title' sort={sort} onSort={onSort} naturalDir='asc'/>
                        <SortTh label='状态' sortKey='status' sort={sort} onSort={onSort} naturalDir='asc'/>
                        <SortTh label='实际单价' sortKey='price' sort={sort} onSort={onSort} naturalDir='asc'/>
                        <SortTh label='占比' sortKey='share' sort={sort} onSort={onSort} naturalDir='desc' className='PersonStats__num'/>
                        <SortTh label='人天（份额）' sortKey='days' sort={sort} onSort={onSort} naturalDir='desc' className='PersonStats__num'/>
                        <SortTh label='实际金额（元）' sortKey='amount' sort={sort} onSort={onSort} naturalDir='desc' className='PersonStats__num'/>
                        <SortTh label='内部折算人天' sortKey='converted' sort={sort} onSort={onSort} naturalDir='desc' className='PersonStats__num'/>
                    </tr>
                </thead>
                <tbody>
                    {sortedFlow.map((f, i) => (
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
                            <td className='PersonStats__num'>{fmtAmount(f.amount)}</td>
                            <td className='PersonStats__num PersonStats__num--conv'>{fmtConverted(convertAmount(config, f.userId, f.amount))} 天</td>
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
                            <td className='PersonStats__num'>总计 {fmtAmount(totalAmount)}</td>
                            <td className='PersonStats__num'>总内部人天：{fmtConverted(totalConverted)} 天</td>
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
