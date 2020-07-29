import React, { Component } from 'react'
import ContentEditable from './components/ContentEditable'
import AppHeader from './components/AppHeader'
import SettingsMenu from './components/SettingsMenu'
import SettingsIcon from './components/SettingsIcon'
import analytics from './utils/analytics'
import api from './utils/api'
import sortByDate from './utils/sortByDate'
import isLocalHost from './utils/isLocalHost'
import './App.css'

export default class App extends Component {
  state = {
    todos: [],
    showMenu: false
  }
  componentDidMount() {

    /* Track a page view */
    analytics.page()

    // Fetch all todos
    api.readAll().then((todos) => {
      if (todos.message === 'unauthorized') {
        if (isLocalHost()) {
          alert('FaunaDB key is not unauthorized. Make sure you set it in terminal session where you ran `npm start`. Visit http://bit.ly/set-fauna-key for more info')
        } else {
          alert('FaunaDB key is not unauthorized. Verify the key `FAUNADB_SERVER_SECRET` set in Netlify enviroment variables is correct')
        }
        return false
      }

      console.log('all todos', todos)
      this.setState({
        todos: todos
      })
    })
  }
  saveTodo = (e) => {
    e.preventDefault()
    const { todos } = this.state
    const todoValue = this.inputElement.value

    if (!todoValue) {
      alert('Please add Todo title')
      this.inputElement.focus()
      return false
    }

    // reset input to empty
    this.inputElement.value = ''

    const todoInfo = {
      title: todoValue,
      completed: false,
    }
    // Optimistically add todo to UI
    const newTodoArray = [{
      data: todoInfo,
      ts: new Date().getTime() * 10000
    }]

    const optimisticTodoState = newTodoArray.concat(todos)

    this.setState({
      todos: optimisticTodoState
    })
    // Make API request to create new todo
    api.create(todoInfo).then((response) => {
      console.log(response)
      /* Track a custom event */
      analytics.track('todoCreated', {
        category: 'todos',
        label: todoValue,
      })
      // remove temporaryValue from state and persist API response
      const persistedState = removeOptimisticTodo(todos).concat(response)
      // Set persisted value to state
      this.setState({
        todos: persistedState
      })
    }).catch((e) => {
      console.log('An API error occurred', e)
      const revertedState = removeOptimisticTodo(todos)
      // Reset to original state
      this.setState({
        todos: revertedState
      })
    })
  }
  deleteTodo = (e) => {
    const { todos } = this.state
    const todoId = e.target.dataset.id

    // Optimistically remove todo from UI
    const filteredTodos = todos.reduce((acc, current) => {
      const currentId = getTodoId(current)
      if (currentId === todoId) {
        // save item being removed for rollback
        acc.rollbackTodo = current
        return acc
      }
      // filter deleted todo out of the todos list
      acc.optimisticState = acc.optimisticState.concat(current)
      return acc
    }, {
      rollbackTodo: {},
      optimisticState: []
    })

    this.setState({
      todos: filteredTodos.optimisticState
    })

    // Make API request to delete todo
    api.delete(todoId).then(() => {
      console.log(`deleted todo id ${todoId}`)
      analytics.track('todoDeleted', {
        category: 'todos',
      })
    }).catch((e) => {
      console.log(`There was an error removing ${todoId}`, e)
      // Add item removed back to list
      this.setState({
        todos: filteredTodos.optimisticState.concat(filteredTodos.rollbackTodo)
      })
    })
  }
  handleTodoCheckbox = (event) => {
    const { todos } = this.state
    const { target } = event
    const todoCompleted = target.checked
    const todoId = target.dataset.id

    const updatedTodos = todos.map((todo, i) => {
      const { data } = todo
      const id = getTodoId(todo)
      if (id === todoId && data.completed !== todoCompleted) {
        data.completed = todoCompleted
      }
      return todo
    })

    this.setState({
      todos: updatedTodos
    }, () => {
      api.update(todoId, {
        completed: todoCompleted
      }).then(() => {
        console.log(`update todo ${todoId}`, todoCompleted)
        const eventName = (todoCompleted) ? 'todoCompleted' : 'todoUnfinished'
        analytics.track(eventName, {
          category: 'todos'
        })
      }).catch((e) => {
        console.log('An API error occurred', e)
      })
    })
  }
  updateTodoTitle = (event, currentValue) => {
    let isDifferent = false
    const todoId = event.target.dataset.key

    const updatedTodos = this.state.todos.map((todo, i) => {
      const id = getTodoId(todo)
      if (id === todoId && todo.data.title !== currentValue) {
        todo.data.title = currentValue
        isDifferent = true
      }
      return todo
    })

    // only set state if input different
    if (isDifferent) {
      this.setState({
        todos: updatedTodos
      }, () => {
        api.update(todoId, {
          title: currentValue
        }).then(() => {
          console.log(`update todo ${todoId}`, currentValue)
          analytics.track('todoUpdated', {
            category: 'todos',
            label: currentValue
          })
        }).catch((e) => {
          console.log('An API error occurred', e)
        })
      })
    }
  }
  clearCompleted = () => {
    const { todos } = this.state

    // Optimistically remove todos from UI
    const data = todos.reduce((acc, current) => {
      if (current.data.completed) {
        // save item being removed for rollback
        acc.completedTodoIds = acc.completedTodoIds.concat(getTodoId(current))
        return acc
      }
      // filter deleted todo out of the todos list
      acc.optimisticState = acc.optimisticState.concat(current)
      return acc
    }, {
      completedTodoIds: [],
      optimisticState: []
    })

    // only set state if completed todos exist
    if (!data.completedTodoIds.length) {
      alert('Please check off some todos to batch remove them')
      this.closeModal()
      return false
    }

    this.setState({
      todos: data.optimisticState
    }, () => {
      setTimeout(() => {
        this.closeModal()
      }, 600)

      api.batchDelete(data.completedTodoIds).then(() => {
        console.log(`Batch removal complete`, data.completedTodoIds)
        analytics.track('todosBatchDeleted', {
          category: 'todos',
        })
      }).catch((e) => {
        console.log('An API error occurred', e)
      })
    })
  }
  closeModal = (e) => {
    this.setState({
      showMenu: false
    })
    analytics.track('modalClosed', {
      category: 'modal'
    })
  }
  openModal = () => {
    this.setState({
      showMenu: true
    })
    analytics.track('modalOpened', {
      category: 'modal'
    })
  }
  renderTodos() {
    const { todos } = this.state

    if (!todos || !todos.length) {
      // Loading State here
      return null
    }

    const timeStampKey = 'ts'
    const orderBy = 'desc' // or `asc`
    const sortOrder = sortByDate(timeStampKey, orderBy)
    const todosByDate = todos.sort(sortOrder)

    return todosByDate.map((todo, i) => {
      const { data, ref } = todo
      const id = getTodoId(todo)
      // only show delete button after create API response returns
      let deleteButton
      if (ref) {
        deleteButton = (
          <button data-id={id} onClick={this.deleteTodo}>
            delete
          </button>
        )
      }
      const boxIcon = (data.completed) ? '#todo__box__done' : '#todo__box'
      return (
        <div key={i} className='todo-item'>
          <label className="todo">
            <input
              data-id={id}
              className="todo__state"
              type="checkbox"
              onChange={this.handleTodoCheckbox}
              checked={data.completed}
            />
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 25" className="todo__icon">
              <use xlinkHref={`${boxIcon}`} className="todo__box"></use>
              <use xlinkHref="#todo__check" className="todo__check"></use>
            </svg>
            <div className='todo-list-title'>
              <ContentEditable
                tagName='span'
                editKey={id}
                onBlur={this.updateTodoTitle} // save on enter/blur
                html={data.title}
                // onChange={this.handleDataChange} // save on change
              />
            </div>
          </label>
          {deleteButton}
        </div>
      )
    })
  }
  handelSubmit = ({ event }) => {
    console.log('hey')
    // var formData = JSON.stringify({
    //   "email": document.getElementById('input-first-name').value,
    //   "firstname": document.getElementById('input-first-name').value,
    //   "last_name": document.getElementById('input-last-name').value,
    //   "phone": document.getElementById('input-phone').value
    // });

    var myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/json");
    myHeaders.append("Authorization", "Bearer eyJhbGciOiJIUzUxMiIsInYiOiIyLjAiLCJraWQiOiJiZjhjODc4ZS1mNDFkLTQzZmMtYmMxZS0xNzZjYWFmMjg2OTAifQ.eyJ2ZXIiOjcsImF1aWQiOiJjY2JhOGM3MDZiMDkzODQ5MDM4ODBlOThiNzY3N2Q1OSIsImNvZGUiOiJCMkwxR3V0dnhiXzNpNWtEblE3UWV1ZUFPZnh6V1dGWWciLCJpc3MiOiJ6bTpjaWQ6QlpTbXZ3ckVTSWFlYmJpeEZmYU1VZyIsImdubyI6MCwidHlwZSI6MCwidGlkIjowLCJhdWQiOiJodHRwczovL29hdXRoLnpvb20udXMiLCJ1aWQiOiIzaTVrRG5RN1FldWVBT2Z4eldXRllnIiwibmJmIjoxNTk2MDMyOTMzLCJleHAiOjE1OTYwMzY1MzMsImlhdCI6MTU5NjAzMjkzMywiYWlkIjoiSFo0VTZHX0FReldrdmpEYmliTE1zQSIsImp0aSI6ImQyOGEwYjU1LWZkOWMtNDQ2ZC05YzUzLTM5ZGY0NjM4NGY5OCJ9.ytOh2X1LrN0QqH2oPDAmnt9V90Nv8CGKM4R3OPkTseRUwTeAX0TX4yIMjhfK9RkFyt2Mk9g3Kt7hjc9KLQb0Pg");
    myHeaders.append("Cookie", "_zm_lang=en-US; zm_gnl_ruid=sd2VKgx_S9Opc_3Xe-LujA; _zm_csp_script_nonce=L18n4_OVToKKn7E2fLzJxw; _zm_mtk_guid=7c1a6feb1dca4fd4936912e1fee91902; zm_cluster=us02; _zm_date_format=mm/dd/yy; _zm_currency=USD; _marketplace_auth_id=645d6c3b-a0d6-4063-b7b7-e96b84f271b7; cred=ABB0A5204A29B3D0EDFC543258E34679; _zm_page_auth=us02_c_4K7nJ-8tR8KwruPd8s3-mg; _zm_ssid=us02_c_I9OkZDJzRXK8gTzVmAyN-A; zm_aid=HZ4U6G_AQzWkvjDbibLMsA; zm_haid=221");

    var raw = JSON.stringify({ "email": "test21sa1qsaqqq22@emai222l", "firstname": "gregAsteqqqt", "last_name": "withA loqqqsqcal", "phone": "2155557212", "job_title": "JumpqqSadr1" });

    var requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: raw,
      redirect: 'follow'
    };

    fetch("https://api.zoom.us/v2/webinars/84840289453/registrants", requestOptions)
      .then(response => response.text())
      .then(result => console.log(result))
      .catch(error => console.log('error', error));

    console.log('sent');
    debugger
  }
  render() {
    return (
      <div className='app'>

        <AppHeader />

        <div className='todo-list'>
          <h2>
            Create todo
            <SettingsIcon onClick={this.openModal} className='mobile-toggle' />
          </h2>
          <form className='todo-create-wrapper' onSubmit={this.saveTodo}>
            <input
              className='todo-create-input'
              placeholder='Add a todo item'
              name='name'
              ref={el => this.inputElement = el}
              autoComplete='off'
              style={{marginRight: 20}}
            />
            <div className='todo-actions'>
              <button className='todo-create-button'>
                Create todo
              </button>
              <SettingsIcon onClick={this.openModal}  className='desktop-toggle' />
            </div>
          </form>

          {this.renderTodos()}
        </div>
        <SettingsMenu
          showMenu={this.state.showMenu}
          handleModalClose={this.closeModal}
          handleClearCompleted={this.clearCompleted}
        />


        <div className="c-block">
          <form onSubmit={this.handelSubmit} method="post" netlify>
            <div>
              <label for="input-first-name">First Name</label>
              <input type="text" name="input-first-name" id="input-first-name" placeholder="FirstName" />
            </div>
            <br />
            <div>
              <label for="input-last-name">Last Name</label>
              <input type="text" name="input-last-name" id="input-last-name" placeholder="Last Name" />
            </div>
            <br />
            <div>
              <label for="input-phone">Lemme get your digits</label>
              <input type="text" name="input-phone" id="input-phone" placeholder="800-555-1212" />
            </div>
            <br />
            <div>
              <label for="input-email">Email</label>
              <input type="email" name="input-email" id="input-email" placeholder="@" />
            </div>
            <br />
            <div>
              <input type="submit" value="Go To Meeting" />
            </div>
            <br />
            <br />
            <br />
          </form>
        </div>
      </div>
    )
  }
}

function removeOptimisticTodo(todos) {
  // return all 'real' todos
  return todos.filter((todo) => {
    return todo.ref
  })
}

function getTodoId(todo) {
  if (!todo.ref) {
    return null
  }
  return todo.ref['@ref'].id
}
