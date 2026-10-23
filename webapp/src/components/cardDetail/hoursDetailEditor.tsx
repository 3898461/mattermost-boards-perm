// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
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
import {ACTUAL_HOURS_PROP, HOURS_DETAIL_PROP, parseHoursDetail, sumHours} from '../../actualHours'
import {sendFlashMessage} from '../flashMessages'
import Button from '../../widgets/buttons/button'

import {producerColor} from './completionDetailEditor'

import './hoursDetailEditor.scss'

type Props = {
    board: Board
    card: Card
    propertyTemplate: IPropertyTemplate
    readOnly: boolean
}

const PRODUCERS_PROP = '制作人'

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

// Per-producer actual hours (2026-10-22): replaces the plain number
// editor of the "实际耗时" property in the card detail. One cell per
// producer (roster = the "制作人" property): avatar, name, and an
// hours input UNDER the avatar, exactly like the reference sketch.
// Saving writes the detail JSON into "实际耗时明细" and the summed
// total into "实际耗时" itself in a single patch, so the number read
// by kanban/table/the move-into-完成 gate is always the detail sum.
// Cards that predate the detail keep their stored total until the
// editor is first saved; the total is shown as "未分人" until then.
const HoursDetailEditor = (props: Props): JSX.Element => {
    const {board, card, propertyTemplate, readOnly} = props
    const intl = useIntl()

    const boardUsersById = useAppSelector((state: RootState) => state.users?.boardUsers || {})
    const me = useAppSelector(getMe)
    const teammateNameDisplay = useAppSelector((state: RootState) => state.clientConfig?.value?.teammateNameDisplay) || 'username'

    const producersTemplate = useMemo(() => findTemplateByName(board, PRODUCERS_PROP), [board])
    const detailTemplate = useMemo(() => findTemplateByName(board, HOURS_DETAIL_PROP), [board])
    const producerIds: string[] = useMemo(() => {
        if (!producersTemplate) {
            return []
        }
        const v = card.fields.properties[producersTemplate.id]
        return Array.isArray(v) ? (v as string[]).filter((id) => typeof id === 'string' && id) : []
    }, [card, producersTemplate])

    const savedDetail = useMemo(
        () => (detailTemplate ? parseHoursDetail(card.fields.properties[detailTemplate.id]) : {}),
        [card, detailTemplate],
    )
    const savedTotal = useMemo(() => {
        const raw = card.fields.properties[propertyTemplate.id]
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''))
        return isNaN(n) ? sumHours(savedDetail) : n
    }, [card, propertyTemplate.id, savedDetail])
    const hasDetail = Object.keys(savedDetail).length > 0

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
    }, [producerIds.join(','), detailTemplate ? card.fields.properties[detailTemplate.id] : '']) // eslint-disable-line react-hooks/exhaustive-deps

    const hoursOf = (id: string): number => {
        const n = parseFloat(draft[id] || '0')
        return isNaN(n) ? 0 : n
    }

    const total = useMemo(() => {
        let sum = 0
        producerIds.forEach((id) => {
            sum += hoursOf(id)
        })
        return round2(sum)
    }, [draft, producerIds]) // eslint-disable-line react-hooks/exhaustive-deps

    const onSave = async () => {
        if (!detailTemplate) {
            return
        }
        const detail: Record<string, number> = {}
        for (const id of producerIds) {
            const raw = (draft[id] || '').trim()
            if (raw === '') {
                detail[id] = 0
                continue
            }
            const n = parseFloat(raw)
            if (isNaN(n) || n < 0) {
                sendFlashMessage({
                    content: intl.formatMessage(
                        {id: 'HoursDetail.invalid-hours', defaultMessage: '“{name}”的耗时必须是不小于 0 的数字'},
                        {name: displayName(id)},
                    ),
                    severity: 'high',
                })
                return
            }
            detail[id] = round2(n)
        }
        const sum = sumHours(detail)
        if (sum === 0 && savedTotal > 0) {
            sendFlashMessage({
                content: intl.formatMessage({id: 'HoursDetail.zero-sum', defaultMessage: '合计为 0，未保存（已有实际耗时 {total}，清空输入会把它清掉）'}, {total: String(savedTotal)}),
                severity: 'high',
            })
            return
        }
        try {
            const newCard = createCard(card)
            newCard.fields.properties[detailTemplate.id] = JSON.stringify(detail)
            newCard.fields.properties[propertyTemplate.id] = String(sum)
            await mutator.updateBlock(board.id, newCard, card, 'set actual hours detail')
            sendFlashMessage({
                content: intl.formatMessage({id: 'HoursDetail.saved', defaultMessage: '实际耗时已保存'}),
                severity: 'normal',
            })
        } catch (e) {
            sendFlashMessage({
                content: intl.formatMessage({id: 'HoursDetail.save-failed', defaultMessage: '保存失败，请重试'}),
                severity: 'high',
            })
        }
    }

    if (!detailTemplate) {
        return (
            <div className='hours-detail-editor hours-detail-editor--hint'>
                {intl.formatMessage({id: 'HoursDetail.no-detail-prop', defaultMessage: '需要先创建“实际耗时明细”文本属性，才能按人填写耗时'})}
            </div>
        )
    }

    if (!producersTemplate) {
        return (
            <div className='hours-detail-editor hours-detail-editor--hint'>
                {intl.formatMessage({id: 'HoursDetail.no-producers-prop', defaultMessage: '需要先创建“制作人”属性'})}
            </div>
        )
    }

    if (producerIds.length === 0) {
        return (
            <div className='hours-detail-editor hours-detail-editor--hint'>
                {savedTotal > 0
                    ? intl.formatMessage({id: 'HoursDetail.legacy-no-producers', defaultMessage: '实际耗时：{total}（未分人；在“制作人”里选人后可按人填写）'}, {total: String(savedTotal)})
                    : intl.formatMessage({id: 'HoursDetail.no-producers', defaultMessage: '先在“制作人”里选择人员，再按人填写耗时'})}
            </div>
        )
    }

    const renderAvatar = (id: string, index: number) => (
        <HoursAvatar
            userId={id}
            name={displayName(id)}
            color={producerColor(index)}
        />
    )

    if (readOnly) {
        return (
            <div className='hours-detail-editor hours-detail-editor--readonly'>
                <div className='hours-detail-editor__cells'>
                    {producerIds.map((id, i) => (
                        <div
                            key={id}
                            className='hours-detail-editor__cell'
                        >
                            {renderAvatar(id, i)}
                            <span className='hours-detail-editor__name'>{displayName(id)}</span>
                            <span className='hours-detail-editor__value'>{savedDetail[id] ?? 0}</span>
                        </div>
                    ))}
                </div>
                <div className='hours-detail-editor__footer'>
                    <span className={`hours-detail-editor__total ${savedTotal > 0 ? 'hours-detail-editor__total--ok' : 'hours-detail-editor__total--bad'}`}>
                        {intl.formatMessage({id: 'HoursDetail.total', defaultMessage: '合计：{total}'}, {total: String(savedTotal)})}
                    </span>
                </div>
                {!hasDetail && savedTotal > 0 && (
                    <div className='hours-detail-editor__hint'>
                        {intl.formatMessage({id: 'HoursDetail.legacy', defaultMessage: '该总数为早期手工填写，尚未按人拆分'})}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className='hours-detail-editor'>
            <div className='hours-detail-editor__cells'>
                {producerIds.map((id, i) => (
                    <div
                        key={id}
                        className='hours-detail-editor__cell'
                    >
                        {renderAvatar(id, i)}
                        <span className='hours-detail-editor__name'>{displayName(id)}</span>
                        <input
                            className='hours-detail-editor__input'
                            type='number'
                            min={0}
                            step='any'
                            value={draft[id] ?? ''}
                            onChange={(e) => setDraft({...draft, [id]: e.target.value})}
                            aria-label={intl.formatMessage({id: 'HoursDetail.input-label', defaultMessage: '{name}的实际耗时'}, {name: displayName(id)})}
                        />
                    </div>
                ))}
            </div>
            {!hasDetail && savedTotal > 0 && (
                <div className='hours-detail-editor__hint'>
                    {intl.formatMessage({id: 'HoursDetail.legacy-edit', defaultMessage: '当前实际耗时 {total}（未分人），填写每人耗时保存后生成明细并覆盖总数'}, {total: String(savedTotal)})}
                </div>
            )}
            <div className='hours-detail-editor__footer'>
                <span className={`hours-detail-editor__total ${total > 0 ? 'hours-detail-editor__total--ok' : 'hours-detail-editor__total--bad'}`}>
                    {intl.formatMessage({id: 'HoursDetail.total', defaultMessage: '合计：{total}'}, {total: String(total)})}
                </span>
                <Button
                    onClick={onSave}
                    className='hours-detail-editor__save'
                >
                    {intl.formatMessage({id: 'HoursDetail.save', defaultMessage: '保存耗时'})}
                </Button>
            </div>
        </div>
    )
}

// Read-only one-line summary of the detail, rendered wherever the
// "实际耗时明细" property itself is shown (card detail row, table
// cell): "唐盈盈 1 · 刘艳玲 1" instead of the raw JSON. A card with a
// stored total but no detail (predates the editor) reads "未分人".
// The detail is written exclusively by HoursDetailEditor above; this
// is display-only in every context.
export const HoursDetailSummary = (props: {board: Board, card: Card}): JSX.Element => {
    const {board, card} = props
    const intl = useIntl()
    const boardUsersById = useAppSelector((state: RootState) => state.users?.boardUsers || {})
    const me = useAppSelector(getMe)
    const teammateNameDisplay = useAppSelector((state: RootState) => state.clientConfig?.value?.teammateNameDisplay) || 'username'

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

    const detailTemplate = findTemplateByName(board, HOURS_DETAIL_PROP)
    const detail = detailTemplate ? parseHoursDetail(card.fields.properties[detailTemplate.id]) : {}
    const hoursTemplate = findTemplateByName(board, ACTUAL_HOURS_PROP)
    const rawTotal = hoursTemplate ? card.fields.properties[hoursTemplate.id] : undefined
    const parsedTotal = typeof rawTotal === 'number' ? rawTotal : parseFloat(String(rawTotal ?? ''))
    const total = isNaN(parsedTotal) ? sumHours(detail) : parsedTotal

    // Order by the 制作人 roster, then any leftover detail entries.
    const producersTemplate = findTemplateByName(board, PRODUCERS_PROP)
    const rosterRaw = producersTemplate ? card.fields.properties[producersTemplate.id] : undefined
    const roster: string[] = Array.isArray(rosterRaw) ? (rosterRaw as string[]).filter((id) => typeof id === 'string' && id) : []
    const orderedIds = [...roster.filter((id) => detail[id] !== undefined), ...Object.keys(detail).filter((id) => !roster.includes(id))]

    if (orderedIds.length === 0) {
        return (
            <span className='hours-detail-summary hours-detail-summary--muted'>
                {total > 0
                    ? intl.formatMessage({id: 'HoursDetail.summary-legacy', defaultMessage: '未分人（总数 {total}）'}, {total: String(round2(total))})
                    : intl.formatMessage({id: 'HoursDetail.summary-empty', defaultMessage: '未填写'})}
            </span>
        )
    }
    return (
        <span className='hours-detail-summary'>
            {orderedIds.map((id) => `${displayName(id)} ${round2(detail[id])}`).join(' · ')}
        </span>
    )
}

// Real Mattermost avatar with a colored-initial fallback, mirroring
// the person stacks elsewhere in the app.
const HoursAvatar = (props: {userId: string, name: string, color: string}): JSX.Element => {
    const [imgError, setImgError] = useState(false)
    if (imgError) {
        return (
            <span
                className='hours-detail-editor__avatar hours-detail-editor__avatar--fallback'
                style={{backgroundColor: props.color}}
                title={props.name}
                aria-hidden='true'
            >
                {props.name ? props.name.charAt(0).toUpperCase() : '?'}
            </span>
        )
    }
    return (
        <img
            className='hours-detail-editor__avatar'
            src={Utils.getProfilePicture(props.userId)}
            alt={props.name}
            title={props.name}
            onError={() => setImgError(true)}
        />
    )
}

export default HoursDetailEditor
