const express = require('express');
const ejs = require('ejs');
const path = require('path');
const mysql = require('mysql');
const app = express();
const cookieParser = require('cookie-parser');
const session = require('express-session');
const md5 = require('md5');
const ws = require('nodejs-websocket');
const bodyParser = require('body-parser');
const dbconfig = require('./config.js');

var jsonParser = bodyParser.json();
var urlencodedParser = bodyParser.urlencoded({extended:false});

var pool = mysql.createPool(dbconfig);

app.use(cookieParser());
app.use(session({
	secret: 'websocket',
	cookie:{maxAge:24 * 60 * 1000},
	resave: false,
	saveUninitialized: true,
}))

app.use(express.static(path.join(__dirname, '')));

app.engine('.html',ejs.renderFile);
app.set('views', path.join(__dirname, 'views'));

app.get('/',function(req,res){
	var $uid = req.session.userid;
	if(!$uid){
		var $users = '请先登录,您也可以选择以下用户实现登录。';
		pool.getConnection(function(err,connection){
			connection.query('select * from user',function(err,result){
				for(var i = 0;i < result.length;i++){
					$users += '<p><a href="/login?name='+result[i].username+'&pwd=123456">'+result[i].username+'</a></p>'
				}
				res.send($users);
			})
			connection.release();
		})
	}else{
		pool.getConnection(function(err,connection){
			if(err){
				res.send('系统错误');
			}
			connection.query('select * from user where id = '+$uid,function(err,result){
				if(err){
					res.send('系统错误');
				}
				new Promise(function(resolve,reject){
					var $friends = result[0].friends;
					//获取自己的好友列表
					connection.query('select * from user where id in ('+$friends+')',function(err,friends){
						if(err){
							reject('系统错误');
						}
						resolve(friends);
					})
				}).then(function(friends){
					//默认获取自己和好友列表第一位好友的聊天记录
					connection.query('select * from chat_record where (from_uid = '+$uid+' and to_uid = '+friends[0].id+') or (from_uid = '+friends[0].id+' and to_uid = '+$uid+') order by addtime asc',function(err,records){
						//默认获取好友列表的第一位好友的头像和用户名
						connection.query('select * from user where id = '+friends[0].id,function(err,toinfo){
							res.render("index.html",{info:result[0],toinfo:toinfo[0],friends:friends,uid:$uid,records:records});
						})
					})
				})
			})
			connection.release();
		})
	}
})

app.get('/reg',function(req,res){
	let username = req.query.name;
	let password = md5(req.query.pwd);
	pool.getConnection(function(err,connection){
		connection.query('insert into user (username,password) values (\''+username+'\',\''+password+'\')',function(err,result){
			if(result){
				res.send('注册成功,您可以现在<a href="/login?name='+username+'&pwd='+req.query.pwd+'">登录</a>;也可以返回<a href="/">首页</a><script type="text/javascript">setInterval(function(){window.location="/"},500);</script>');
			}
		});
		connection.release();
	})
})

app.get('/login',function(req,res){
	let username = req.query.name;
	let password = md5(req.query.pwd);
	pool.getConnection(function(err,connection){
		connection.query('select * from user where username = \''+username+'\' and password = \''+password+'\'',function(err,result){
			if(err){
				res.send('系统错误');
			}
			if(result){
				req.session.userid = result[0].id;
				req.session.username = result[0].username;
				res.send('登陆成功,跳转<a href="/">首页</a><script type="text/javascript">setInterval(function(){window.location="/"},500);</script>');
			}else{
				res.send('用户不存在或账号密码错误');
			}
		})
		connection.release();
	})
})

app.get('/logout',function(req,res){
	req.session.userid = null;
	req.session.username = null;
	res.send('成功退出登录! 前往<a href="/">首页</a>');
})

//获取聊天记录接口
app.post('/getRecords',urlencodedParser,function(req,res){
	var from_uid = req.body.from_uid;
	var to_uid = req.body.to_uid;
	pool.getConnection(function(err,connection){
		connection.query('select * from chat_record where (from_uid = '+from_uid+' and to_uid = '+to_uid+') or (from_uid = '+to_uid+' and to_uid = '+from_uid+') order by addtime asc',function(err,result){
			if(err){
				console.log('程序出错!');
				return;
			}
			res.send(JSON.stringify(result));
		})
		connection.release();
	})
})

//连接数
var connections = [];
var message = {};

var server = ws.createServer(function(connect){
	connect.on('text',function(str){
		user = JSON.parse(str);
		//每个用户登录就插入一条连接数
		connections.push(user);
		// connections = connections.slice(-2);
		//发送人信息
		message.uid = user.userid;
		message.headimg = user.headimg;
		message.username = user.username;
		//接收人信息
		message.touserid = user.touserid;
		message.toheadimg = user.toheadimg;
		message.tousername = user.tousername;

		message.type = user.type;
		
		if(user.type != 'enter'){
			message.data = user.data;
		}else{
			message.data = '';
		}
		//发送消息不是enter类型,并且发送人和接收人不能为同一个
		if(user.type != 'enter'  && user.userid != user.touserid){
			pool.getConnection(function(err,conn){
				if(err){
				}else{
					//每次聊天插入一条聊天记录
					var sql = 'insert into chat_record (from_uid,to_uid,content,addtime) values ('+user.userid+','+user.touserid+',\''+user.data+'\','+Date.parse(new Date())/1000+')';
					conn.query(sql,function(err,result){
					})
				}
				conn.release();
			})
		}
		broadcast(JSON.stringify(message));
	})
	connect.on('close',function(err){
		console.log('websocket连接关闭!');
	})
	connect.on('error',function(){
		console.log('websocket连接出错!');
	})
}).listen(3000);

//循环发送消息
function broadcast(str) {
    server.connections.forEach(function(connection) {
        connection.sendText(str);
    })
}

app.listen(8088,function(){
	console.log('listening port 8088');
});

