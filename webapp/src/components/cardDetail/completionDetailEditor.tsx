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
//
// Smart allocation rules (2026-10-21):
// - 1 producer: share is locked to 100% automatically.
// - 2 producers: editing one sets the other to 100 - value; 50:50 preset
//   and a swap button are provided.
// - 3+ producers: fully manual, with one-click equal split and per-row
//   "fill the remainder" helpers. Total must still be exactly 100 to save.
const PRODUCERS_PROP = '制作人'
const TOTAL_PROP = '总完成度'

// Stable per-person colors for the segmented share bar and the avatar
// circles in the producer micro-cards (cycles if there are more people).
export const PRODUCER_COLORS = [
    '#1c7ed6', '#e8590c', '#2b8a3e', '#862e9c', '#e64980',
    '#0b7285', '#a61e4d', '#5f3dc4', '#d9480f', '#1971c2',
]

export function producerColor(index: number): string {
    return PRODUCER_COLORS[index % PRODUCER_COLORS.length]
}

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function clampShare(n: number): number {
    if (isNaN(n)) {
        return 0
    }
    return round2(Math.min(100, Math.max(0, n)))
}

// Equal split of 100 across ids; the last person absorbs rounding so the
// total is exactly 100.
export function splitEvenly(ids: string[]): Record<string, string> {
    const out: Record<string, string> = {}
    if (ids.length === 0) {
        return out
    }
    const each = round2(100 / ids.length)
    let acc = 0
    ids.forEach((id, i) => {
        if (i === ids.length - 1) {
            out[id] = String(round2(100 - acc))
        } else {
            out[id] = String(each)
            acc = round2(acc + each)
        }
    })
    return out
}

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
        return Array.isArray(v) ? (v as string[]).filter((id) => typeof id === 'string' && id) : []
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
        // Single producer: the share is always 100% (input locked below).
        if (producerIds.length === 1) {
            next[producerIds[0]] = '100'
        }
        setDraft(next)
    }, [producerIds.join(','), card.fields.properties[propertyTemplate.id]]) // eslint-disable-line react-hooks/exhaustive-deps

    const shareOf = (id: string): number => {
        const n = parseFloat(draft[id] || '0')
        return isNaN(n) ? 0 : n
    }

    const total = useMemo(() => {
        let sum = 0
        producerIds.forEach((id) => {
            sum += shareOf(id)
        })
        return round2(sum)
    }, [draft, producerIds]) // eslint-disable-line react-hooks/exhaustive-deps

    const totalOk = Math.abs(total - 100) < 1e-9
    const count = producerIds.length
    const single = count === 1
    const pair = count === 2

    // --- smart allocation handlers -------------------------------------

    const onShareChange = (id: string, raw: string) => {
        if (single) {
            return
        }
        const next = {...draft, [id]: raw}
        if (pair) {
            const n = parseFloat(raw)
            if (!isNaN(n)) {
                const other = producerIds.find((p) => p !== id)!
                next[other] = String(clampShare(100 - n))
            }
        }
        setDraft(next)
    }

    const onPreset5050 = () => {
        if (pair) {
            setDraft({[producerIds[0]]: '50', [producerIds[1]]: '50'})
        }
    }

    const onSwap = () => {
        if (!pair) {
            return
        }
        const [a, b] = producerIds
        setDraft({...draft, [a]: draft[b] ?? '', [b]: draft[a] ?? ''})
    }

    const onSplitEvenly = () => {
        setDraft(splitEvenly(producerIds))
    }

    // Fill this person's share with whatever is left to reach 100.
    const onFillRemainder = (id: string) => {
        let others = 0
        producerIds.forEach((p) => {
            if (p !== id) {
                others += shareOf(p)
            }
        })
        setDraft({...draft, [id]: String(clampShare(100 - others))})
    }

    // --- save (unchanged hard validation: total must be exactly 100) ---

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

    // Segmented colored share bar + producer micro-card, shared by the
    // editable and read-only renderings. Values come from `values`.
    const renderShareVisuals = (values: Record<string, number>) => {
        const sum = producerIds.reduce((acc, id) => acc + (values[id] || 0), 0)
        return (
            <div
                className='completion-detail-editor__bar'
                role='img'
                aria-label={producerIds.map((id) => `${displayName(id)} ${values[id] || 0}%`).join('，')}
            >
                {producerIds.map((id, i) => {
                    const share = values[id] || 0
                    if (share <= 0) {
                        return null
                    }
                    // Width is relative to 100 when the split is complete;
                    // relative to the current sum while still editing, so
                    // the bar always reflects proportions truthfully.
                    const base = sum > 100 ? sum : 100
                    return (
                        <div
                            key={id}
                            className='completion-detail-editor__bar-segment'
                            style={{width: `${(share / base) * 100}%`, backgroundColor: producerColor(i)}}
                            title={`${displayName(id)} ${share}%`}
                        />
                    )
                })}
            </div>
        )
    }

    const renderMicroCard = (id: string, index: number) => (
        <span className='completion-detail-editor__person'>
            <span
                className='completion-detail-editor__avatar'
                style={{backgroundColor: producerColor(index)}}
                aria-hidden='true'
            >
                {displayName(id).slice(0, 1)}
            </span>
            <span className='completion-detail-editor__name'>{displayName(id)}</span>
        </span>
    )

    if (readOnly) {
        return (
            <div className='completion-detail-editor completion-detail-editor--readonly'>
                {renderShareVisuals(savedDetail)}
                {producerIds.map((id, i) => (
                    <div
                        key={id}
                        className='completion-detail-editor__row'
                    >
                        {renderMicroCard(id, i)}
                        <span className='completion-detail-editor__readonly-pct'>{`${savedDetail[id] ?? 0}%`}</span>
                    </div>
                ))}
            </div>
        )
    }

    const draftValues: Record<string, number> = {}
    producerIds.forEach((id) => {
        draftValues[id] = shareOf(id)
    })

    return (
        <div className='completion-detail-editor'>
            {renderShareVisuals(draftValues)}
            {producerIds.map((id, i) => (
                <div
                    key={id}
                    className='completion-detail-editor__row'
                >
                    {renderMicroCard(id, i)}
                    <input
                        className='completion-detail-editor__input'
                        type='number'
                        min={0}
                        max={100}
                        step='any'
                        value={single ? '100' : (draft[id] ?? '')}
                        disabled={single}
                        onChange={(e) => onShareChange(id, e.target.value)}
                        aria-label={displayName(id)}
                    />
                    <span className='completion-detail-editor__pct'>%</span>
                    {count >= 3 && (
                        <button
                            type='button'
                            className='completion-detail-editor__mini-btn'
                            onClick={() => onFillRemainder(id)}
                            title={intl.formatMessage({id: 'CompletionDetail.fill-title', defaultMessage: '把剩余差额补给此人'})}
                        >
                            {intl.formatMessage({id: 'CompletionDetail.fill', defaultMessage: '补齐'})}
                        </button>
                    )}
                </div>
            ))}
            {single && (
                <div className='completion-detail-editor__hint'>
                    {intl.formatMessage({id: 'CompletionDetail.single-auto', defaultMessage: '只有一位制作人，已自动设为 100%'})}
                </div>
            )}
            {pair && (
                <div className='completion-detail-editor__tools'>
                    <button
                        type='button'
                        className='completion-detail-editor__mini-btn'
                        onClick={onPreset5050}
                    >
                        {'50:50'}
                    </button>
                    <button
                        type='button'
                        className='completion-detail-editor__mini-btn'
                        onClick={onSwap}
                    >
                        {intl.formatMessage({id: 'CompletionDetail.swap', defaultMessage: '互换比例'})}
                    </button>
                </div>
            )}
            {count >= 3 && (
                <div className='completion-detail-editor__tools'>
                    <button
                        type='button'
                        className='completion-detail-editor__mini-btn'
                        onClick={onSplitEvenly}
                    >
                        {intl.formatMessage({id: 'CompletionDetail.even', defaultMessage: '一键均分'})}
                    </button>
                </div>
            )}
            <div className='completion-detail-editor__footer'>
                <span className={`completion-detail-editor__total ${totalOk ? 'completion-detail-editor__total--ok' : 'completion-detail-editor__total--bad'}`}>
                    {intl.formatMessage({id: 'CompletionDetail.total', defaultMessage: '合计：{total}%'}, {total: String(total)})}
                </span>
                <div className='completion-detail-editor__save-wrapper'>
                    <Button
                        onClick={onSave}
                        className='completion-detail-editor__save'
                    >
                        {intl.formatMessage({id: 'CompletionDetail.save', defaultMessage: '保存分工'})}
                    </Button>
                    <span className='completion-detail-editor__save-spacer'>%</span>
                </div>
            </div>
        </div>
    )
}

export default CompletionDetailEditor
