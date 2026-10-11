// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.


import React from 'react'

import {Board, IPropertyTemplate, safePropertyValue} from '../blocks/board'
import {Card} from '../blocks/card'

import propsRegistry from '../properties'
import {isAutoManagedProperty} from '../settleAutomation'
import CompletionDetailEditor from './cardDetail/completionDetailEditor'
import {useAppSelector} from '../store/hooks'
import {getMe} from '../store/users'
import {RootState} from '../store'
import {IUser} from '../user'
import {Utils} from '../utils'

// Properties rendered by dedicated settle editors instead of the registry.
const SETTLE_CUSTOM_EDITORS: Record<string, boolean> = {
    '完成度明细': true,
}

// Compact read-only summary for person properties in non-detailed views
// (table/kanban/gallery/calendar): plain text names instead of interactive badges.
const PersonSummary = ({card, propertyTemplate}: {card: Card, propertyTemplate: IPropertyTemplate}): JSX.Element => {
    const boardUsersById = useAppSelector((state: RootState) => state.users?.boardUsers || {})
    const teammateNameDisplay = useAppSelector((state: RootState) => state.clientConfig?.value?.teammateNameDisplay) || 'username'
    const me = useAppSelector(getMe)

    const value = card.fields.properties[propertyTemplate.id]
    const userIds: string[] = Array.isArray(value) ? value.filter((v) => typeof v === 'string') : (typeof value === 'string' && value ? [value] : [])

    const displayName = (userId: string): string => {
        const user: IUser | undefined = boardUsersById[userId]
        if (user) {
            return Utils.getUserDisplayName(user, teammateNameDisplay)
        }
        if (me && me.id === userId) {
            return Utils.getUserDisplayName(me, teammateNameDisplay)
        }
        return userId
    }

    return <span>{userIds.map(displayName).join('、')}</span>
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
    const effectiveReadOnly = readOnly || isAutoManagedProperty(propertyTemplate.name)
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
    // Person properties in non-detailed views: compact text summary.
    if (!props.detailed && (propertyTemplate.type === 'person' || propertyTemplate.type === 'multiPerson')) {
        return <PersonSummary card={card} propertyTemplate={propertyTemplate} />
    }
    return (
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
}

export default PropertyValueElement
