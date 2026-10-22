// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useState} from 'react'
import {useIntl} from 'react-intl'

import {Board} from '../../blocks/board'
import {Card} from '../../blocks/card'
import {IUser} from '../../user'
import {useAppSelector} from '../../store/hooks'
import {getMe} from '../../store/users'
import {RootState} from '../../store'
import {Utils} from '../../utils'
import {getAmountSnapshot} from '../../settleAutomation'

import './amountLockBadge.scss'

type Props = {
    board: Board
    card: Card
}

// Gold lock badge shown next to 实际金额 / 项目状态 once a card's
// financial snapshot has been frozen (first entry into 待付款/已付款).
// Clicking it opens a popover with the frozen values.
const AmountLockBadge = (props: Props): JSX.Element | null => {
    const intl = useIntl()
    const [open, setOpen] = useState(false)
    const boardUsersById = useAppSelector((state: RootState) => state.users?.boardUsers || {})
    const me = useAppSelector(getMe)
    const teammateNameDisplay = useAppSelector((state: RootState) => state.clientConfig?.value?.teammateNameDisplay) || 'username'

    const snapshot = getAmountSnapshot(props.card)
    if (!snapshot) {
        return null
    }

    const displayName = (userId?: string): string => {
        if (!userId) {
            return '-'
        }
        const user: IUser | undefined = boardUsersById[userId]
        if (user) {
            return Utils.getUserDisplayName(user, teammateNameDisplay)
        }
        if (me && me.id === userId) {
            return Utils.getUserDisplayName(me, teammateNameDisplay)
        }
        return '未知用户'
    }

    const formatMoney = (v?: number) => '¥' + (v ?? 0).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})
    const detailEntries = Object.entries(snapshot.detail || {})

    return (
        <span className='amount-lock'>
            <button
                type='button'
                className='amount-lock__badge'
                onClick={() => setOpen(!open)}
                title={intl.formatMessage({id: 'AmountLock.badge-title', defaultMessage: '查看财务快照'})}
            >
                {'🔒 '}
                {intl.formatMessage({id: 'AmountLock.badge', defaultMessage: '财务快照已固化'})}
            </button>
            {open && (
                <div className='amount-lock__popover'>
                    <div className='amount-lock__popover-head'>
                        <span>{intl.formatMessage({id: 'AmountLock.popover-title', defaultMessage: '财务快照'})}</span>
                        <button
                            type='button'
                            className='amount-lock__close'
                            onClick={() => setOpen(false)}
                            aria-label='Close'
                        >
                            {'×'}
                        </button>
                    </div>
                    <div className='amount-lock__row'>
                        <span>{intl.formatMessage({id: 'AmountLock.locked-at', defaultMessage: '固化时间'})}</span>
                        <b>{new Date(snapshot.lockedAt).toLocaleString()}</b>
                    </div>
                    <div className='amount-lock__row'>
                        <span>{intl.formatMessage({id: 'AmountLock.locked-by', defaultMessage: '操作人'})}</span>
                        <b>{displayName(snapshot.lockedBy)}</b>
                    </div>
                    <div className='amount-lock__row'>
                        <span>{intl.formatMessage({id: 'AmountLock.status', defaultMessage: '锁定时状态'})}</span>
                        <b>{snapshot.status}</b>
                    </div>
                    <div className='amount-lock__row'>
                        <span>{intl.formatMessage({id: 'AmountLock.amount', defaultMessage: '总金额'})}</span>
                        <b>{formatMoney(snapshot.amount)}</b>
                    </div>
                    <div className='amount-lock__row'>
                        <span>{intl.formatMessage({id: 'AmountLock.days', defaultMessage: '人天'})}</span>
                        <b>{snapshot.personDays ?? 0}</b>
                    </div>
                    {snapshot.unitPrice !== undefined && (
                        <div className='amount-lock__row'>
                            <span>{intl.formatMessage({id: 'AmountLock.unit-price', defaultMessage: '单价'})}</span>
                            <b>{formatMoney(snapshot.unitPrice)}</b>
                        </div>
                    )}
                    {detailEntries.length > 0 && (
                        <div className='amount-lock__detail'>
                            <div className='amount-lock__detail-title'>
                                {intl.formatMessage({id: 'AmountLock.detail', defaultMessage: '分工明细（固化时）'})}
                            </div>
                            {detailEntries.map(([userId, share]) => (
                                <div
                                    key={userId}
                                    className='amount-lock__row'
                                >
                                    <span>{displayName(userId)}</span>
                                    <b>
                                        {`${share}% · ${formatMoney(((snapshot.amount ?? 0) * share) / 100)}`}
                                    </b>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </span>
    )
}

export default AmountLockBadge
