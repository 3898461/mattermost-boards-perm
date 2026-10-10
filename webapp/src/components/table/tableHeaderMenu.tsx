// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {FC} from 'react'
import {useIntl} from 'react-intl'

import {Constants, Permission} from '../../constants'
import {Board, IPropertyTemplate} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import {Card} from '../../blocks/card'
import mutator from '../../mutator'
import Menu from '../../widgets/menu'
import BoardPermissionGate from '../permissions/boardPermissionGate'
import MemberPermissionPicker from '../memberPermissionPicker'
import {getPropertyVisibleTo} from '../../propertyPermissions'

type Props = {
    templateId: string
    board: Board
    activeView: BoardView
    views: BoardView[]
    cards: Card[]
}

const TableHeaderMenu: FC<Props> = (props: Props): JSX.Element => {
    const {board, activeView, templateId, views, cards} = props
    const intl = useIntl()
    return (
        <Menu>
            <Menu.Text
                id='sortAscending'
                name={intl.formatMessage({id: 'TableHeaderMenu.sort-ascending', defaultMessage: 'Sort ascending'})}
                onClick={() => mutator.changeViewSortOptions(board.id, activeView.id, activeView.fields.sortOptions, [{propertyId: templateId, reversed: false}])}
            />
            <Menu.Text
                id='sortDescending'
                name={intl.formatMessage({id: 'TableHeaderMenu.sort-descending', defaultMessage: 'Sort descending'})}
                onClick={() => mutator.changeViewSortOptions(board.id, activeView.id, activeView.fields.sortOptions, [{propertyId: templateId, reversed: true}])}
            />
            <Menu.Text
                id='insertLeft'
                name={intl.formatMessage({id: 'TableHeaderMenu.insert-left', defaultMessage: 'Insert left'})}
                onClick={() => {
                    if (props.templateId === Constants.titleColumnId) {
                        // eslint-disable-next-line no-warning-comments
                        // TODO: Handle name column
                    } else {
                        const index = board.cardProperties.findIndex((o: IPropertyTemplate) => o.id === templateId)
                        mutator.insertPropertyTemplate(board, activeView, index)
                    }
                }}
            />
            <Menu.Text
                id='insertRight'
                name={intl.formatMessage({id: 'TableHeaderMenu.insert-right', defaultMessage: 'Insert right'})}
                onClick={() => {
                    if (templateId === Constants.titleColumnId) {
                        // eslint-disable-next-line no-warning-comments
                        // TODO: Handle title column
                    } else {
                        const index = board.cardProperties.findIndex((o: IPropertyTemplate) => o.id === templateId) + 1
                        mutator.insertPropertyTemplate(board, activeView, index)
                    }
                }}
            />
            {props.templateId !== Constants.titleColumnId &&
                <>
                    <BoardPermissionGate permissions={[Permission.ManageBoardProperties]}>
                        <Menu.SubMenu
                            id='visibility'
                            name={intl.formatMessage({id: 'PropertyMenu.view-permissions', defaultMessage: 'View permissions'})}
                        >
                            <MemberPermissionPicker
                                userIDs={getPropertyVisibleTo(board.cardProperties.find((t: IPropertyTemplate) => t.id === templateId)!) || []}
                                onChange={(userIDs) => {
                                    const template = board.cardProperties.find((t: IPropertyTemplate) => t.id === templateId)!
                                    mutator.changePropertyVisibility(board.id, board.cardProperties, template, userIDs.length > 0 ? userIDs : undefined)
                                }}
                            />
                            <Menu.Text
                                id='visible-to-everyone'
                                name={intl.formatMessage({id: 'PropertyMenu.visible-to-everyone', defaultMessage: 'Visible to everyone'})}
                                onClick={() => {
                                    const template = board.cardProperties.find((t: IPropertyTemplate) => t.id === templateId)!
                                    mutator.changePropertyVisibility(board.id, board.cardProperties, template, undefined)
                                }}
                            />
                        </Menu.SubMenu>
                    </BoardPermissionGate>
                    <Menu.Text
                        id='hide'
                        name={intl.formatMessage({id: 'TableHeaderMenu.hide', defaultMessage: 'Hide'})}
                        onClick={() => mutator.changeViewVisibleProperties(board.id, activeView.id, activeView.fields.visiblePropertyIds, activeView.fields.visiblePropertyIds.filter((o: string) => o !== templateId))}
                    />
                    <Menu.Text
                        id='duplicate'
                        name={intl.formatMessage({id: 'TableHeaderMenu.duplicate', defaultMessage: 'Duplicate'})}
                        onClick={() => mutator.duplicatePropertyTemplate(board, activeView, templateId)}
                    />
                    <Menu.Text
                        id='delete'
                        name={intl.formatMessage({id: 'TableHeaderMenu.delete', defaultMessage: 'Delete'})}
                        onClick={() => mutator.deleteProperty(board, views, cards, templateId)}
                    />
                </>}
        </Menu>
    )
}

export default TableHeaderMenu
