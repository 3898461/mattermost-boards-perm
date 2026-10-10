// Copyright (c) 2026-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback} from 'react'
import {useIntl} from 'react-intl'

import {ActionMeta, MultiValue, SingleValue} from 'react-select'

import {IUser} from '../user'
import {useAppSelector} from '../store/hooks'
import {getMe} from '../store/users'

import PersonSelector from './personSelector'

type Props = {
    userIDs: string[]
    onChange: (userIDs: string[]) => void
}

// Multi member picker used for view-permission settings. The current user is
// always kept in the list so nobody can lock themselves out of content they
// just restricted. Clearing the list entirely is done via a separate
// "visible to everyone" action next to this picker.
const MemberPermissionPicker = (props: Props): JSX.Element => {
    const {userIDs, onChange} = props
    const intl = useIntl()
    const me = useAppSelector(getMe)

    const handleChange = useCallback((items: SingleValue<IUser> | MultiValue<IUser>, _action: ActionMeta<IUser>) => {
        let ids: string[] = []
        if (Array.isArray(items)) {
            ids = items.map((u) => u.id)
        }
        if (me && !ids.includes(me.id)) {
            ids = [...ids, me.id]
        }
        onChange(ids)
    }, [me, onChange])

    return (
        <PersonSelector
            readOnly={false}
            userIDs={userIDs}
            allowAddUsers={false}
            isMulti={true}
            showMe={true}
            closeMenuOnSelect={false}
            emptyDisplayValue={intl.formatMessage({id: 'MemberPermissionPicker.empty', defaultMessage: 'Select members...'})}
            onChange={handleChange}
        />
    )
}

export default MemberPermissionPicker
