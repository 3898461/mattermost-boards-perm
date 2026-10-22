// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react'
import {useIntl} from 'react-intl'

import {IUser} from '../user'
import {useAppSelector} from '../store/hooks'
import {getMe} from '../store/users'
import {RootState} from '../store'
import {Utils} from '../utils'
import {
    CompletionConfirmRequest,
    CompletionConfirmResult,
    registerCompletionConfirmHandler,
} from '../completionConfirm'
import {producerColor} from './cardDetail/completionDetailEditor'
import Button from '../widgets/buttons/button'
import Dialog from './dialog'

import './completionConfirmHost.scss'

type Pending = {
    req: CompletionConfirmRequest
    resolve: (result: CompletionConfirmResult) => void
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function clampShare(n: number): number {
    if (isNaN(n)) {
        return 0
    }
    return Math.min(100, Math.max(0, round2(n)))
}

// Global host for the 《确认制作人分工与完成度分配比例》 dialog.
// Mounted once in App; mutator.changePropertyValue reaches it through
// the completionConfirm registry when a multi-producer card is moved
// into the "完成" status.
//
// 2026-10-21 revision: the dialog shows ONLY producer + editable
// completion share (converted days/amounts were removed). Two
// producers auto-complement (100 - X); three or more are manual.
// Confirming is only possible when the shares total exactly 100, and
// the edited shares are returned so the mutator writes them back in
// the same patch as the status change.
const CompletionConfirmHost = (): JSX.Element | null => {
    const intl = useIntl()
    const [pending, setPending] = useState<Pending | null>(null)
    const [shares, setShares] = useState<Record<string, number>>({})
    const pendingRef = useRef<Pending | null>(null)

    const boardUsersById = useAppSelector((state: RootState) => state.users?.boardUsers || {})
    const me = useAppSelector(getMe)
    const teammateNameDisplay = useAppSelector((state: RootState) => state.clientConfig?.value?.teammateNameDisplay) || 'username'

    useEffect(() => {
        const unregister = registerCompletionConfirmHandler((req) => new Promise<CompletionConfirmResult>((resolve) => {
            const p = {req, resolve}
            pendingRef.current = p
            setShares(Object.fromEntries(req.rows.map((r) => [r.userId, r.share])))
            setPending(p)
        }))
        return unregister
    }, [])

    if (!pending) {
        return null
    }

    const displayName = (userId: string): string => {
        const user: IUser | undefined = boardUsersById[userId]
        if (user) {
            return Utils.getUserDisplayName(user, teammateNameDisplay)
        }
        if (me && me.id === userId) {
            return Utils.getUserDisplayName(me, teammateNameDisplay)
        }
        return '未知用户'
    }

    const settle = (result: CompletionConfirmResult) => {
        pending.resolve(result)
        pendingRef.current = null
        setPending(null)
    }

    const {req} = pending
    const ids = req.rows.map((r) => r.userId)
    const total = round2(ids.reduce((acc, id) => acc + (shares[id] ?? 0), 0))
    const totalOk = Math.abs(total - 100) < 1e-9

    const onShareChange = (userId: string, value: number) => {
        const v = clampShare(value)
        setShares((prev) => {
            const next = {...prev, [userId]: v}
            if (ids.length === 2) {
                const other = ids.find((id) => id !== userId)
                if (other) {
                    next[other] = clampShare(100 - v)
                }
            }
            return next
        })
    }

    return (
        <Dialog
            size='medium'
            className='completion-confirm-dialog'
            onClose={() => settle({confirmed: false})}
            title={(
                <span>
                    {intl.formatMessage({id: 'CompletionConfirm.heading', defaultMessage: '确认制作人分工与完成度分配比例'})}
                </span>
            )}
        >
            <div className='completion-confirm'>
                <div className='completion-confirm__card'>{req.cardTitle}</div>
                <table className='completion-confirm__table'>
                    <thead>
                        <tr>
                            <th>{intl.formatMessage({id: 'CompletionConfirm.producer', defaultMessage: '制作人'})}</th>
                            <th>{intl.formatMessage({id: 'CompletionConfirm.share', defaultMessage: '完成度占比'})}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {req.rows.map((row, i) => (
                            <tr key={row.userId}>
                                <td>
                                    <span className='completion-confirm__person'>
                                        <span
                                            className='completion-confirm__avatar'
                                            style={{backgroundColor: producerColor(i)}}
                                            aria-hidden='true'
                                        >
                                            {displayName(row.userId).slice(0, 1)}
                                        </span>
                                        {displayName(row.userId)}
                                    </span>
                                </td>
                                <td>
                                    <span className='completion-confirm__share'>
                                        <input
                                            type='range'
                                            min={0}
                                            max={100}
                                            step={1}
                                            value={shares[row.userId] ?? 0}
                                            onChange={(e) => onShareChange(row.userId, parseFloat(e.target.value))}
                                            aria-label={intl.formatMessage({id: 'CompletionConfirm.share', defaultMessage: '完成度占比'})}
                                        />
                                        <input
                                            type='number'
                                            min={0}
                                            max={100}
                                            step={1}
                                            value={shares[row.userId] ?? 0}
                                            onChange={(e) => onShareChange(row.userId, parseFloat(e.target.value))}
                                        />
                                        <span>{'%'}</span>
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <div className={totalOk ? 'completion-confirm__total completion-confirm__total--ok' : 'completion-confirm__total completion-confirm__total--bad'}>
                    {intl.formatMessage(
                        {id: 'CompletionConfirm.total', defaultMessage: '合计 {total}%（必须为 100% 才能确认）'},
                        {total: String(total)},
                    )}
                </div>
            </div>
            <div className='completion-confirm__footer'>
                <Button onClick={() => settle({confirmed: false})}>
                    {intl.formatMessage({id: 'CompletionConfirm.cancel', defaultMessage: '取消'})}
                </Button>
                <Button
                    onClick={() => settle({confirmed: true, shares})}
                    disabled={!totalOk}
                >
                    {intl.formatMessage({id: 'CompletionConfirm.confirm', defaultMessage: '确认完成'})}
                </Button>
            </div>
        </Dialog>
    )
}

export default CompletionConfirmHost
