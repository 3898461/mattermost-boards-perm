// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useState} from 'react'
import {useIntl} from 'react-intl'

import {Board, IPropertyTemplate} from '../../blocks/board'
import {Card, createCard} from '../../blocks/card'
import {IUser} from '../../user'
import mutator from '../../mutator'
import {useAppSelector} from '../../store/hooks'
import {getMe} from '../../store/users'
import {RootState} from '../../store'
import {Utils} from '../../utils'
import {findTemplateByName} from '../../settleAutomation'
import {sendFlashMessage} from '../flashMessages'
import Button from '../../widgets/buttons/button'

import './completionDetailEditor.scss'

type Props = {
    board: Board
    card: Card
    propertyTemplate: IPropertyTemplate
    readOnly: boolean
}

// Completion split across producers, e.g. {"<userId>": 20, "<userId>": 80}.
// Rows follow the "制作人" (multi-person) property, so any headcount works.
// Saved only when every share is 0-100 and the total is exactly 100.
const PRODUCERS_PROP = '制作人'
const TOTAL_PROP = '总完成度'

function parseDetail(raw: unknown): Record<string, number> {
    if (typeof raw !== 'string' || !raw) {
        return {}
    }
    try {
        const obj = JSON.parse(raw)
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            const out: Record<string, number> = {}
            Object.entries(obj).forEach(([k, v]) => {
                const n = typeof v === 'number' ? v : parseFloat(String(v))
                if (!isNaN(n)) {
                    out[k] = n
                }
            })
            return out
        }
    } catch {
        // Corrupt JSON is treated as empty; saving overwrites it.
    }
    return {}
}

const CompletionDetailEditor = (props: Props): JSX.Element => {
    const {board, card, propertyTemplate, readOnly} = props
    const intl = useIntl()

    const boardUsersById = useAppSelector((state: RootState) => state.users?.boardUsers || {})
    const me = useAppSelector(getMe)
    const teammateNameDisplay = useAppSelector((state: RootState) => state.clientConfig?.value?.teammateNameDisplay) || 'username'

    const producersTemplate = useMemo(() => findTemplateByName(board, PRODUCERS_PROP), [board])
    const producerIds: string[] = useMemo(() => {
        if (!producersTemplate) {
            return []
        }
        const v = card.fields.properties[producersTemplate.id]
        return Array.isArray(v) ? (v as string[]) : []
    }, [card, producersTemplate])

    const savedDetail = useMemo(
        () => parseDetail(card.fields.properties[propertyTemplate.id]),
        [card, propertyTemplate.id],
    )

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

    // Draft values as strings so partially-typed input is preserved.
    const [draft, setDraft] = useState<Record<string, string>>({})
    useEffect(() => {
        const next: Record<string, string> = {}
        producerIds.forEach((id) => {
            next[id] = savedDetail[id] !== undefined ? String(savedDetail[id]) : ''
        })
        setDraft(next)
    }, [producerIds.join(','), card.fields.properties[propertyTemplate.id]]) // eslint-disable-line react-hooks/exhaustive-deps

    const total = useMemo(() => {
        let sum = 0
        producerIds.forEach((id) => {
            const n = parseFloat(draft[id] || '0')
            if (!isNaN(n)) {
                sum += n
            }
        })
        return Math.round(sum * 100) / 100
    }, [draft, producerIds])

    const totalOk = Math.abs(total - 100) < 1e-9

    const onSave = async () => {
        // Rebuild from the current producer list: drop removed people,
        // add newcomers as 0, then validate.
        const detail: Record<string, number> = {}
        for (const id of producerIds) {
            const n = parseFloat(draft[id] || '0')
            if (isNaN(n) || n < 0 || n > 100) {
                sendFlashMessage({
                    content: intl.formatMessage(
                        {id: 'CompletionDetail.invalid-share', defaultMessage: '“{name}”的分工必须是 0–100 的数字'},
                        {name: displayName(id)},
                    ),
                    severity: 'high',
                })
                return
            }
            detail[id] = Math.round(n * 100) / 100
        }
        const sum = Object.values(detail).reduce((a, b) => a + b, 0)
        if (Math.abs(sum - 100) >= 1e-9) {
            sendFlashMessage({
                content: intl.formatMessage(
                    {id: 'CompletionDetail.sum-not-100', defaultMessage: '分工合计必须等于 100%（当前 {total}%），未保存'},
                    {total: String(Math.round(sum * 100) / 100)},
                ),
                severity: 'high',
            })
            return
        }
        // Single updateBlock for both properties: avoids races between two
        // sequential changePropertyValue calls based on the same stale card.
        try {
            const newCard = createCard(card)
            newCard.fields.properties[propertyTemplate.id] = JSON.stringify(detail)
            const totalTemplate = findTemplateByName(board, TOTAL_PROP)
            if (totalTemplate) {
                newCard.fields.properties[totalTemplate.id] = String(Math.round(sum * 100) / 100)
            }
            await mutator.updateBlock(board.id, newCard, card, 'set completion detail')
            sendFlashMessage({
                content: intl.formatMessage({id: 'CompletionDetail.saved', defaultMessage: '分工已保存'}),
                severity: 'normal',
            })
        } catch (e) {
            sendFlashMessage({
                content: intl.formatMessage({id: 'CompletionDetail.save-failed', defaultMessage: '保存失败，请重试'}),
                severity: 'high',
            })
        }
    }

    if (!producersTemplate) {
        return (
            <div className='completion-detail-editor completion-detail-editor--hint'>
                {intl.formatMessage({id: 'CompletionDetail.no-producers-prop', defaultMessage: '需要先创建“制作人”属性'})}
            </div>
        )
    }

    if (producerIds.length === 0) {
        return (
            <div className='completion-detail-editor completion-detail-editor--hint'>
                {intl.formatMessage({id: 'CompletionDetail.no-producers', defaultMessage: '先在“制作人”里选择人员'})}
            </div>
        )
    }

    if (readOnly) {
        return (
            <div className='completion-detail-editor completion-detail-editor--readonly'>
                {producerIds.map((id) => `${displayName(id)} ${savedDetail[id] ?? 0}%`).join(' · ')}
            </div>
        )
    }

    return (
        <div className='completion-detail-editor'>
            {producerIds.map((id) => (
                <div
                    key={id}
                    className='completion-detail-editor__row'
                >
                    <span className='completion-detail-editor__name'>{displayName(id)}</span>
                    <input
                        className='completion-detail-editor__input'
                        type='number'
                        min={0}
                        max={100}
                        step='any'
                        value={draft[id] ?? ''}
                        onChange={(e) => setDraft({...draft, [id]: e.target.value})}
                        aria-label={displayName(id)}
                    />
                    <span className='completion-detail-editor__pct'>%</span>
                </div>
            ))}
            <div className='completion-detail-editor__footer'>
                <span className={`completion-detail-editor__total ${totalOk ? 'completion-detail-editor__total--ok' : 'completion-detail-editor__total--bad'}`}>
                    {intl.formatMessage({id: 'CompletionDetail.total', defaultMessage: '合计：{total}%'}, {total: String(total)})}
                </span>
                <Button onClick={onSave}>
                    {intl.formatMessage({id: 'CompletionDetail.save', defaultMessage: '保存分工'})}
                </Button>
            </div>
        </div>
    )
}

export default CompletionDetailEditor
