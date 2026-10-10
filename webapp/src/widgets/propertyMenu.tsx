// Copyright (c) 2020-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react'
import {useIntl, IntlShape} from 'react-intl'

import Menu from '../widgets/menu'
import propsRegistry from '../properties'
import {PropertyType} from '../properties/types'
import {Board, IPropertyTemplate} from '../blocks/board'
import mutator from '../mutator'
import MemberPermissionPicker from '../components/memberPermissionPicker'
import {getPropertyVisibleTo} from '../propertyPermissions'
import './propertyMenu.scss'

type Props = {
    propertyId: string
    propertyName: string
    propertyType: PropertyType
    board?: Board
    template?: IPropertyTemplate
    onTypeAndNameChanged: (newType: PropertyType, newName: string) => void
    onDelete: (id: string) => void
}

function typeMenuTitle(intl: IntlShape, type: PropertyType): string {
    return `${intl.formatMessage({id: 'PropertyMenu.typeTitle', defaultMessage: 'Type'})}: ${type.displayName(intl)}`
}

type TypesProps = {
    label: string
    onTypeSelected: (type: PropertyType) => void
}

export const PropertyTypes = (props: TypesProps): JSX.Element => {
    const intl = useIntl()
    return (
        <>
            <Menu.Label>
                <b>{props.label}</b>
            </Menu.Label>

            <Menu.Separator/>

            {
                propsRegistry.list().map((p) => (
                    <Menu.Text
                        key={p.type}
                        id={p.type}
                        name={p.displayName(intl)}
                        onClick={() => props.onTypeSelected(p)}
                    />
                ))
            }
        </>
    )
}

const PropertyMenu = (props: Props) => {
    const intl = useIntl()
    let currentPropertyName = props.propertyName

    const deleteText = intl.formatMessage({
        id: 'PropertyMenu.Delete',
        defaultMessage: 'Delete',
    })

    return (
        <Menu>
            <Menu.TextInput
                initialValue={props.propertyName}
                onConfirmValue={(n) => {
                    props.onTypeAndNameChanged(props.propertyType, n)
                    currentPropertyName = n
                }}
                onValueChanged={(n) => {
                    currentPropertyName = n
                }}
            />
            <Menu.SubMenu
                id='type'
                name={typeMenuTitle(intl, props.propertyType)}
            >
                <PropertyTypes
                    label={intl.formatMessage({id: 'PropertyMenu.changeType', defaultMessage: 'Change property type'})}
                    onTypeSelected={(type: PropertyType) => props.onTypeAndNameChanged(type, currentPropertyName)}
                />
            </Menu.SubMenu>
            {props.board && props.template &&
                <Menu.SubMenu
                    id='visibility'
                    name={intl.formatMessage({id: 'PropertyMenu.view-permissions', defaultMessage: 'View permissions'})}
                    sticky={true}
                >
                    <MemberPermissionPicker
                        userIDs={getPropertyVisibleTo(props.template) || []}
                        onChange={(userIDs) => mutator.changePropertyVisibility(props.board!.id, props.board!.cardProperties, props.template!, userIDs.length > 0 ? userIDs : undefined)}
                    />
                    <Menu.Text
                        id='visible-to-everyone'
                        name={intl.formatMessage({id: 'PropertyMenu.visible-to-everyone', defaultMessage: 'Visible to everyone'})}
                        onClick={() => mutator.changePropertyVisibility(props.board!.id, props.board!.cardProperties, props.template!, undefined)}
                    />
                </Menu.SubMenu>}
            <Menu.Text
                id='delete'
                name={deleteText}
                onClick={() => props.onDelete(props.propertyId)}
            />
        </Menu>
    )
}

export default React.memo(PropertyMenu)
