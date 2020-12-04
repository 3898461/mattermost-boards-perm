// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import React from 'react'

import {
    withRouter,
    RouteComponentProps,
    Link,
} from 'react-router-dom'

import Button from '../widgets/buttons/button'
import client from '../octoClient'
import './loginPage.scss'

type Props = RouteComponentProps

type State = {
    username: string
    password: string
}

class LoginPage extends React.PureComponent<Props, State> {
    state = {
        username: '',
        password: '',
    }

    private handleLogin = async (): Promise<void> => {
        const logged = await client.login(this.state.username, this.state.password)
        if (logged) {
            this.props.history.push('/')
        }
    }

    render(): React.ReactNode {
        return (
            <div className='LoginPage'>
                <div className='username'>
                    <label htmlFor='login-username'>{'Username'}</label>
                    <input
                        id='login-username'
                        value={this.state.username}
                        onChange={(e) => this.setState({username: e.target.value})}
                    />
                </div>
                <div className='password'>
                    <label htmlFor='login-username'>{'Password'}</label>
                    <input
                        id='login-password'
                        type='password'
                        value={this.state.password}
                        onChange={(e) => this.setState({password: e.target.value})}
                    />
                </div>
                <Button onClick={this.handleLogin}>{'Login'}</Button>
                <Link to='/register'>{'or create an account if you don\'t have one'}</Link>
            </div>
        )
    }
}

export default withRouter(LoginPage)
