// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.


import React from 'react'

import {Board, IPropertyTemplate, safePropertyValue} from '../blocks/board'
import {Card} from '../blocks/card'

import propsRegistry from '../properties'
import {isAutoManagedProperty} from '../settleAutomation'
import CompletionDetailEditor from './cardDetail/completionDetailEditor'

// Properties rendered by dedicated settle editors instead of the registry.
const SETTLE_CUSTOM_EDITORS: Record<string, boolean> = {
    '完成度明细': true,
}

type Props = {
    board: Board
    readOnly: boolean
    card: Card
    propertyTemplate: IPropertyTemplate
    showEmptyPlaceholder: boolean
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
                readOnly={effectiveReadOnly}
            />
        )
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
