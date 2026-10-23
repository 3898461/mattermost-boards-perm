// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.


import React, {useState} from 'react'

import {Board, IPropertyTemplate, safePropertyValue} from '../blocks/board'
import {Card} from '../blocks/card'

import propsRegistry from '../properties'
import {isAutoManagedProperty, isAmountLocked, SETTLE_PROP_NAMES} from '../settleAutomation'

import {useAppSelector} from '../store/hooks'
import {getMe} from '../store/users'
import {RootState} from '../store'
import {IUser} from '../user'
import {Utils} from '../utils'

import CompletionDetailEditor from './cardDetail/completionDetailEditor'
import AmountLockBadge from './cardDetail/amountLockBadge'

import './propertyValueElement.scss'

// Properties rendered by dedicated settle editors instead of the registry.
const SETTLE_CUSTOM_EDITORS: Record<string, boolean> = {
    '完成度明细': true,
}

// One avatar in the person stack. Falls back to an initial letter when
// the image fails to load (e.g. unknown user id).
const PersonAvatar = ({userId, name}: {userId: string, name: string}): JSX.Element => {
    const [imgError, setImgError] = useState(false)
    if (imgError) {
        const initial = name ? name.charAt(0).toUpperCase() : '?'
        return (
            <span
                className='PersonAvatarStack-fallback'
                title={name}
            >
                {initial}
            </span>
        )
    }
    return (
        <img
            className='PersonAvatarStack-img'
            src={Utils.getProfilePicture(userId)}
            alt={name}
            title={name}
            onError={() => setImgError(true)}
        />
    )
}

// Overlapping avatar stack for person properties in non-detailed views
// (table/kanban/gallery/calendar): avatars only, no names. Hover shows
// the name via the title attribute.
const PersonSummary = ({card, propertyTemplate}: {card: Card, propertyTemplate: IPropertyTemplate}): JSX.Element => {
    const boardUsersById = useAppSelector((state: RootState) => state.users?.boardUsers || {})
    const teammateNameDisplay = useAppSelector((state: RootState) => state.clientConfig?.value?.teammateNameDisplay) || 'username'
    const me = useAppSelector(getMe)

    const value = card.fields.properties[propertyTemplate.id]
    const userIds: string[] = Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : (typeof value === 'string' && value ? [value] : [])

    if (userIds.length === 0) {
        return <span>未指定</span>
    }

    const displayName = (userId: string): string => {
        const user: IUser | undefined = boardUsersById[userId]
        if (user) {
            return Utils.getUserDisplayName(user, teammateNameDisplay)
        }
        if (me && me.id === userId) {
            return Utils.getUserDisplayName(me, teammateNameDisplay)
        }
        // User not in board members (e.g. removed, or card copied from another
        // board): don't leak the raw 26-char ID, show a placeholder.
        return '未知用户'
    }

    return (
        <span className='PersonAvatarStack'>
            {userIds.map((userId, index) => (
                <span
                    key={userId}
                    className='PersonAvatarStack-avatar'
                    style={{zIndex: index}}
                >
                    <PersonAvatar
                        userId={userId}
                        name={displayName(userId)}
                    />
                </span>
            ))}
        </span>
    )
}

type Props = {
    board: Board
    readOnly: boolean
    card: Card
    propertyTemplate: IPropertyTemplate
    showEmptyPlaceholder: boolean
    detailed?: boolean
}

const PropertyValueElement = (props: Props): JSX.Element => {
    const {card, propertyTemplate, readOnly, showEmptyPlaceholder, board} = props

    const propertyValue = safePropertyValue(card.fields.properties[propertyTemplate.id])
    const property = propsRegistry.get(propertyTemplate.type)
    const Editor = property.Editor
    // Settlement auto-managed properties (单价/实际金额/总完成度) are
    // display-only; every save recomputes them anyway.
    // Once the financial snapshot is frozen, 人天 and 实际单价 are
    // locked read-only too: their edits drive the amount calculation.
    const amountLocked = isAmountLocked(card)
    const lockedReadOnly = amountLocked &&
        (propertyTemplate.name === SETTLE_PROP_NAMES.personDays || propertyTemplate.name === SETTLE_PROP_NAMES.unitPriceSelect)
    const effectiveReadOnly = readOnly || isAutoManagedProperty(propertyTemplate.name) || lockedReadOnly
    if (SETTLE_CUSTOM_EDITORS[propertyTemplate.name || '']) {
        return (
            <CompletionDetailEditor
                board={board}
                card={card}
                propertyTemplate={propertyTemplate}
                readOnly={effectiveReadOnly || !props.detailed}
            />
        )
    }
    // Person properties in non-detailed views: overlapping avatar stack.
    if (!props.detailed && (propertyTemplate.type === 'person' || propertyTemplate.type === 'multiPerson')) {
        return <PersonSummary card={card} propertyTemplate={propertyTemplate} />
    }
    const editor = (
        <Editor
            property={property}
            card={card}
            board={board}
            readOnly={effectiveReadOnly}
            showEmptyPlaceholder={showEmptyPlaceholder}
            propertyTemplate={propertyTemplate}
            propertyValue={propertyValue}
        />
    )
    // Gold lock badge next to 实际金额 / 项目状态 in the card detail
    // (detailed) rendering once the snapshot exists.
    const showLockBadge = Boolean(props.detailed) && amountLocked &&
        (propertyTemplate.name === SETTLE_PROP_NAMES.amount || propertyTemplate.name === SETTLE_PROP_NAMES.projectStatus)
    if (showLockBadge) {
        return (
            <span className='property-value-element__lockwrap'>
                {editor}
                <AmountLockBadge
                    board={board}
                    card={card}
                />
            </span>
        )
    }
    return editor
}

export default PropertyValueElement
