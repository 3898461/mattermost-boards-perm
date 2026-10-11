// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useMemo, useState} from 'react'
import {useIntl} from 'react-intl'

import {Board} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import {Card} from '../../blocks/card'
import {useAppSelector} from '../../store/hooks'
import {getMe, getUser} from '../../store/users'
import {getCurrentBoard} from '../../store/boards'
import {useHasCurrentBoardPermissions} from '../../hooks/permissions'
import {Permission} from '../../constants'

import {aggregatePersonStats, getMonthRange, getQuarterRange, getYearRange, DateRange, PersonStatRow} from './aggregation'

import './personStats.scss'

type Props = {
    board: Board
    activeView: BoardView
    cards: Card[]
    readonly: boolean
}

type RangePreset = 'month' | 'quarter' | 'year' | 'custom'

const PersonStats = (props: Props): JSX.Element => {
    const intl = useIntl()
    const me = useAppSelector(getMe)
    const board = useAppSelector(getCurrentBoard) || props.board

    // Permissions
    const isAdmin = useHasCurrentBoardPermissions([Permission.ManageBoardRoles])
    const canSeeAmounts = isAdmin

    // Date range state
    const [preset, setPreset] = useState<RangePreset>('month')
    const [customStart, setCustomStart] = useState('')
    const [customEnd, setCustomEnd] = useState('')

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
        // custom
        const start = customStart ? new Date(customStart + 'T00:00:00').getTime() : 0
        const end = customEnd ? new Date(customEnd + 'T23:59:59').getTime() : Date.now()
        return {start, end}
    }, [preset, customStart, customEnd])

    // Check for required properties
    const hasRequiredProps = useMemo(() => {
        const names = board.cardProperties.map((p) => p.name)
        return names.includes('人天') && names.includes('完成度明细') && names.includes('项目状态')
    }, [board])

    // Aggregate
    const allRows = useMemo(() => {
        if (!hasRequiredProps) {
            return []
        }
        return aggregatePersonStats(board, props.cards, range)
    }, [board, props.cards, range, hasRequiredProps])

    // Row-level permission: non-admins only see their own row
    const rows = useMemo(() => {
        if (isAdmin) {
            return allRows
        }
        if (!me) {
            return []
        }
        return allRows.filter((r) => r.userId === me.id)
    }, [allRows, isAdmin, me])

    // Totals
    const totals = useMemo(() => {
        const t: PersonStatRow = {
            userId: '__total__',
            totalDays: 0, scheduledDays: 0, completedDays: 0, settledDays: 0,
            totalAmount: 0, scheduledAmount: 0, completedAmount: 0, settledAmount: 0,
            projectCount: 0,
        }
        // Distinct projects across all people (avoid double-counting shared cards)
        const allProjectIds = new Set<string>()
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
        // Recompute distinct projects from aggregation (pass through)
        // Note: rows don't carry card IDs, so we approximate via the
        // aggregation function's internal tracking. For now, sum is kept
        // as a simple indicator; distinct count requires card-level data.
        for (const r of rows) {
            t.projectCount += r.projectCount
        }
        return t
    }, [rows])

    const formatDays = (v: number) => v.toFixed(1)
    const formatAmount = (v: number) => v.toFixed(2)

    return (
        <div className='PersonStats'>
            <div className='PersonStats__controls'>
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
            </div>

            {!hasRequiredProps && (
                <div className='PersonStats__warning'>
                    此 board 缺少结算属性（需要：人天、完成度明细、项目状态）。请在结算 board（如 1ALL）中使用人员统计。
                </div>
            )}

            {hasRequiredProps && (
            <table className='PersonStats__table'>
                <thead>
                    <tr>
                        <th>姓名</th>
                        <th>项目数</th>
                        <th>总人天</th>
                        <th>已安排人天</th>
                        <th>已完成(未结算)人天</th>
                        <th>已结算人天</th>
                        {canSeeAmounts && (
                            <>
                                <th>总金额</th>
                                <th>已安排金额</th>
                                <th>已完成(未结算)金额</th>
                                <th>已结算金额</th>
                            </>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <PersonStatRowView
                            key={row.userId}
                            row={row}
                            canSeeAmounts={canSeeAmounts}
                            formatDays={formatDays}
                            formatAmount={formatAmount}
                        />
                    ))}
                    {rows.length === 0 && (
                        <tr>
                            <td colSpan={canSeeAmounts ? 10 : 6} className='PersonStats__empty'>
                                暂无数据
                            </td>
                        </tr>
                    )}
                </tbody>
                {rows.length > 0 && (
                    <tfoot>
                        <tr className='PersonStats__total'>
                            <td>合计</td>
                            <td>{totals.projectCount}</td>
                            <td>{formatDays(totals.totalDays)}</td>
                            <td>{formatDays(totals.scheduledDays)}</td>
                            <td>{formatDays(totals.completedDays)}</td>
                            <td>{formatDays(totals.settledDays)}</td>
                            {canSeeAmounts && (
                                <>
                                    <td>{formatAmount(totals.totalAmount)}</td>
                                    <td>{formatAmount(totals.scheduledAmount)}</td>
                                    <td>{formatAmount(totals.completedAmount)}</td>
                                    <td>{formatAmount(totals.settledAmount)}</td>
                                </>
                            )}
                        </tr>
                    </tfoot>
                )}
            </table>
            )}
        </div>
    )
}

type RowProps = {
    row: PersonStatRow
    canSeeAmounts: boolean
    formatDays: (v: number) => string
    formatAmount: (v: number) => string
}

const PersonStatRowView = (props: RowProps): JSX.Element => {
    const user = useAppSelector(getUser(props.row.userId))
    const displayName = user ? (user.username || user.id) : '未知用户'

    return (
        <tr>
            <td>{displayName}</td>
            <td>{props.row.projectCount}</td>
            <td>{props.formatDays(props.row.totalDays)}</td>
            <td>{props.formatDays(props.row.scheduledDays)}</td>
            <td>{props.formatDays(props.row.completedDays)}</td>
            <td>{props.formatDays(props.row.settledDays)}</td>
            {props.canSeeAmounts && (
                <>
                    <td>{props.formatAmount(props.row.totalAmount)}</td>
                    <td>{props.formatAmount(props.row.scheduledAmount)}</td>
                    <td>{props.formatAmount(props.row.completedAmount)}</td>
                    <td>{props.formatAmount(props.row.settledAmount)}</td>
                </>
            )}
        </tr>
    )
}

export default PersonStats
