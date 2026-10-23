// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useState} from 'react'
import {useIntl} from 'react-intl'

import {Board} from '../../blocks/board'
import {Card} from '../../blocks/card'
import octoClient from '../../octoClient'
import {useAppSelector} from '../../store/hooks'
import {getBoards} from '../../store/boards'
import {findTemplateByName, SETTLE_PROP_NAMES} from '../../settleAutomation'
import {sendFlashMessage} from '../flashMessages'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import './archiveModal.scss'

type Props = {
    board: Board
    cards: Card[]
    onClose: () => void
}

// Date property values come in several shapes (ms number, ms string,
// {from, to} range object). Returns epoch ms or undefined.
export function parseCardDate(raw: unknown): number | undefined {
    if (typeof raw === 'number' && raw > 0) {
        return raw
    }
    if (typeof raw === 'string' && raw) {
        const n = parseFloat(raw)
        return isNaN(n) ? undefined : n
    }
    if (raw && typeof raw === 'object') {
        const from = (raw as {from?: unknown}).from
        if (typeof from === 'number' && from > 0) {
            return from
        }
    }
    return undefined
}

// "YYYY-MM" -> epoch ms at the end of that month (local time).
function endOfMonth(monthValue: string): number | undefined {
    const m = /^(\d{4})-(\d{2})$/.exec(monthValue)
    if (!m) {
        return undefined
    }
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10), 1).getTime() - 1
}

export type ArchiveCandidate = {
    card: Card
    amount: number
}

// Cards eligible for archiving: status is 已付款, and (when a cutoff
// month is chosen) the 付款日期 falls in or before that month.
export function selectArchiveCandidates(board: Board, cards: Card[], cutoffMonth: string): ArchiveCandidate[] {
    const statusTemplate = findTemplateByName(board, SETTLE_PROP_NAMES.projectStatus)
    const amountTemplate = findTemplateByName(board, SETTLE_PROP_NAMES.amount)
    const paidDateTemplate = findTemplateByName(board, SETTLE_PROP_NAMES.datePaid)
    if (!statusTemplate) {
        return []
    }
    const paidOptionIds = new Set(statusTemplate.options.filter((o) => o.value.trim() === '已付款').map((o) => o.id))
    if (paidOptionIds.size === 0) {
        return []
    }
    const cutoff = cutoffMonth ? endOfMonth(cutoffMonth) : undefined
    const out: ArchiveCandidate[] = []
    for (const card of cards) {
        const statusValue = card.fields.properties[statusTemplate.id]
        if (typeof statusValue !== 'string' || !paidOptionIds.has(statusValue)) {
            continue
        }
        if (cutoff !== undefined) {
            const paidAt = paidDateTemplate ? parseCardDate(card.fields.properties[paidDateTemplate.id]) : undefined
            // Without a payment date the card cannot be proven to be
            // inside the cutoff, so it is left out (safer for archives).
            if (paidAt === undefined || paidAt > cutoff) {
                continue
            }
        }
        const amount = amountTemplate ? (parseFloat(String(card.fields.properties[amountTemplate.id] ?? '')) || 0) : 0
        out.push({card, amount})
    }
    return out
}

const ArchiveModal = (props: Props): JSX.Element => {
    const {board, cards, onClose} = props
    const intl = useIntl()
    const boardsById = useAppSelector(getBoards)

    const targetBoards = useMemo(() => {
        return Object.values(boardsById).
            filter((b) => b.teamId === board.teamId && b.id !== board.id && !b.isTemplate && !b.deleteAt).
            sort((a, b) => a.title.localeCompare(b.title))
    }, [boardsById, board])

    const [targetBoardId, setTargetBoardId] = useState('')
    const [cutoffMonth, setCutoffMonth] = useState('')
    const [busy, setBusy] = useState(false)

    const candidates = useMemo(
        () => selectArchiveCandidates(board, cards, cutoffMonth),
        [board, cards, cutoffMonth],
    )
    const candidateKey = candidates.map((c) => c.card.id).join(',')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    useEffect(() => {
        setSelected(new Set(candidates.map((c) => c.card.id)))
    }, [candidateKey]) // eslint-disable-line react-hooks/exhaustive-deps

    const selectedCandidates = candidates.filter((c) => selected.has(c.card.id))
    const totalAmount = selectedCandidates.reduce((acc, c) => acc + c.amount, 0)
    const formatMoney = (v: number) => '¥' + v.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})

    const toggle = (id: string) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    const onConfirm = async () => {
        if (!targetBoardId || selectedCandidates.length === 0) {
            return
        }
        setBusy(true)
        try {
            const res = await octoClient.archiveCards(board.id, selectedCandidates.map((c) => c.card.id), targetBoardId)
            sendFlashMessage({
                content: intl.formatMessage(
                    {id: 'ArchiveModal.done', defaultMessage: '已归档 {count} 张卡片（时间戳保持不变）'},
                    {count: res.count},
                ),
                severity: 'normal',
            })
            onClose()
        } catch (e) {
            sendFlashMessage({
                content: intl.formatMessage({id: 'ArchiveModal.failed', defaultMessage: '归档失败，请重试（需要看板管理员权限）'}),
                severity: 'high',
            })
            setBusy(false)
        }
    }

    return (
        <Dialog
            size='medium'
            className='archive-modal'
            onClose={onClose}
            title={(
                <span>
                    {intl.formatMessage({id: 'ArchiveModal.title', defaultMessage: '📦 历史卡片归档工具'})}
                </span>
            )}
        >
            <div className='archive-modal__body'>
                <label className='archive-modal__field'>
                    <span>{intl.formatMessage({id: 'ArchiveModal.target', defaultMessage: '目标归档看板'})}</span>
                    <select
                        value={targetBoardId}
                        onChange={(e) => setTargetBoardId(e.target.value)}
                    >
                        <option value=''>
                            {intl.formatMessage({id: 'ArchiveModal.target-placeholder', defaultMessage: '请选择同团队的看板'})}
                        </option>
                        {targetBoards.map((b) => (
                            <option
                                key={b.id}
                                value={b.id}
                            >
                                {b.title || b.id}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='archive-modal__field'>
                    <span>{intl.formatMessage({id: 'ArchiveModal.cutoff', defaultMessage: '截止月份（含该月，仅「已付款」卡片）'})}</span>
                    <input
                        type='month'
                        value={cutoffMonth}
                        onChange={(e) => setCutoffMonth(e.target.value)}
                    />
                </label>

                <div className='archive-modal__summary'>
                    {intl.formatMessage(
                        {id: 'ArchiveModal.summary', defaultMessage: '预检：共 {count} 张，实际金额合计 {total}'},
                        {count: selectedCandidates.length, total: formatMoney(totalAmount)},
                    )}
                </div>
                <div className='archive-modal__list'>
                    {candidates.map(({card, amount}) => (
                        <label
                            key={card.id}
                            className='archive-modal__item'
                        >
                            <input
                                type='checkbox'
                                checked={selected.has(card.id)}
                                onChange={() => toggle(card.id)}
                            />
                            <span className='archive-modal__item-title'>{card.title || card.id}</span>
                            <span className='archive-modal__item-amount'>{formatMoney(amount)}</span>
                        </label>
                    ))}
                    {candidates.length === 0 && (
                        <div className='archive-modal__empty'>
                            {intl.formatMessage({id: 'ArchiveModal.empty', defaultMessage: '没有符合条件的「已付款」卡片'})}
                        </div>
                    )}
                </div>
                <div className='archive-modal__note'>
                    {intl.formatMessage({id: 'ArchiveModal.note', defaultMessage: '归档会把卡片及其评论、内容整体迁移到目标看板，创建/更新时间保持原始值不变。'})}
                </div>
            </div>
            <div className='archive-modal__footer'>
                <Button
                    onClick={onClose}
                    className='archive-modal__cancel'
                >
                    {intl.formatMessage({id: 'ArchiveModal.cancel', defaultMessage: '取消'})}
                </Button>
                <Button
                    onClick={onConfirm}
                    className='archive-modal__confirm'
                    disabled={!targetBoardId || selectedCandidates.length === 0 || busy}
                >
                    {intl.formatMessage({id: 'ArchiveModal.confirm', defaultMessage: '确认归档'})}
                </Button>
            </div>
        </Dialog>
    )
}

export default ArchiveModal
