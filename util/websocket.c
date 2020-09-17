/*
 * Copyright (c) 2014 Cesanta Software Limited
 * All rights reserved
 */

#include "mongoose.h"

static sig_atomic_t s_signal_received = 0;
static struct mg_serve_http_opts s_http_server_opts;
static char *s_http_port, *server_pwd;
static struct mg_connection *sn_c = NULL;   //supernode_js_connection

static void signal_handler(int sig_num) {
  signal(sig_num, signal_handler);  // Reinstantiate signal handler
  s_signal_received = sig_num;
}

static int is_websocket(const struct mg_connection *nc) {
  return nc->flags & MG_F_IS_WEBSOCKET;
}

//System_display [wss => console]
static void sys_display(struct mg_connection *nc, char type[25]){
  char addr[32];
  mg_sock_addr_to_str(&nc->sa, addr, sizeof(addr), MG_SOCK_STRINGIFY_IP | MG_SOCK_STRINGIFY_PORT);
  printf("%s\t%s\n", addr, type);
}

//System_unicast [wss => nc]
static void sys_unicast(struct mg_connection *nc, const struct mg_str msg) {
  if (nc != NULL)
    mg_send_websocket_frame(nc, WEBSOCKET_OP_TEXT, msg.p, (int)msg.len);
}

//System_broadcast [wss => all]
static void sys_broadcast(struct mg_connection *nc, const struct mg_str msg) {
  struct mg_connection *c;
  for (c = mg_next(nc->mgr, NULL); c != NULL; c = mg_next(nc->mgr, c)) {
    if (c == nc) continue;
    mg_send_websocket_frame(c, WEBSOCKET_OP_TEXT, msg.p, (int)msg.len);
  }
}

//Broadcast incoming message [sn_c => all]
static void broadcast(const struct mg_str msg) {
  printf("\nBROADCAST\t[%d]", (int)msg.len-1);
  struct mg_connection *c;
  for (c = mg_next(sn_c->mgr, NULL); c != NULL; c = mg_next(sn_c->mgr, c)) {
    if (c == sn_c) continue;
    mg_send_websocket_frame(c, WEBSOCKET_OP_TEXT,  msg.p, (int)msg.len);
  }
}

//Groupcast incoming message [sn_c => gid]
static void groupcast(const struct mg_str msg) {
  char gid[35];
  snprintf(gid, sizeof(gid), "%.*s", 34, &msg.p[1]);
  printf("\nGROUPCAST\t[%d]", (int)msg.len - 36);
  struct mg_connection *c;
  for (c = mg_next(sn_c->mgr, NULL); c != NULL; c = mg_next(sn_c->mgr, c)) {
    if (c == sn_c) continue; 
    else if (!strcmp(c->gid, gid))
      mg_send_websocket_frame(c, WEBSOCKET_OP_TEXT, msg.p, (int)msg.len);
  }
}

//Unicast incoming message [sn_c => uid-gid]
static void unicast(const struct mg_str msg) {
  char uid[6], gid[35];
  snprintf(uid, sizeof(uid), "%.*s", 5, &msg.p[1]);
  snprintf(gid, sizeof(gid), "%.*s", 34, &msg.p[7]);
  printf("\nUNICAST\t[%d]", (int)msg.len - 42);
  struct mg_connection *c;
  for (c = mg_next(sn_c->mgr, NULL); c != NULL; c = mg_next(sn_c->mgr, c)) {
    if (c == sn_c) continue; 
    else if (!strcmp(c->gid, gid) && !strcmp(c->uid, uid))
      mg_send_websocket_frame(c, WEBSOCKET_OP_TEXT, msg.p, (int)msg.len);
  }
}

//Forward incoming message [user => sn_c]
static void forward(const struct mg_str msg) {
  printf("\nFORWARD\t[%d]", (int)msg.len - 41);
  if(sn_c != NULL)
    mg_send_websocket_frame(sn_c, WEBSOCKET_OP_TEXT, msg.p, (int)msg.len);
  else
    printf("\nWARNING: No supernode connected");
}

static void ev_handler(struct mg_connection *nc, int ev, void *ev_data) {
  switch (ev) {
    case MG_EV_WEBSOCKET_HANDSHAKE_DONE: {
      /*New Websocket Connection*/
      sys_display(nc, "+Connected+");
      if (sn_c != NULL)
        sys_unicast(nc, mg_mk_str("$+"));
      else
        sys_unicast(nc, mg_mk_str("$-"));
      break;
    }
    case MG_EV_WEBSOCKET_FRAME: {
      /* New Websocket Message*/
      struct websocket_message *wm = (struct websocket_message *) ev_data;
      struct mg_str d = {(char *) wm->data, wm->size};
      if (d.p[0] == '$') {
        if (sn_c == NULL) {
          char pass[100];
          snprintf(pass, sizeof(pass), "%.*s",(int)d.len-1, &d.p[1]);
          if (!strcmp(pass, server_pwd)) {
            sn_c = nc;
            sys_unicast(nc, mg_mk_str("$Access Granted"));
            sys_display(nc, "*Supernode LoggedIn*");
            sys_broadcast(nc, mg_mk_str("$+"));
          } else
            sys_unicast(nc, mg_mk_str("$Access Denied"));
        } else
          sys_unicast(nc, mg_mk_str("$Access Locked"));
      } else if (nc == sn_c) {
        switch (d.p[0]) {
          case '@': unicast(d); break;
          case '#': groupcast(d); break;
          default: broadcast(d);
        }
      } else {
        snprintf(nc->gid, sizeof(nc->gid), "%.*s", 34, &d.p[0]);
        snprintf(nc->uid, sizeof(nc->uid), "%.*s", 5, &d.p[35]);
        forward(d);
      }
      break;
    }
    case MG_EV_HTTP_REQUEST: {
      mg_serve_http(nc, (struct http_message *) ev_data, s_http_server_opts);
      break;
    }
    case MG_EV_CLOSE: {
      /* Websocket Disconnected */
      if (is_websocket(nc)) {
        if(nc == sn_c) {
          sn_c = NULL;
          sys_display(nc,"!Supernode LoggedOut!");
          sys_broadcast(nc, mg_mk_str("$-"));
        } else
          sys_display(nc, "-Disconnected-");
      }
      break;
    }
  }
}

int main(int argc, char** argv) {

  s_http_port = argv[1];
  server_pwd = argv[2];

  struct mg_mgr mgr;
  struct mg_connection *nc;

  signal(SIGTERM, signal_handler);
  signal(SIGINT, signal_handler);
  setvbuf(stdout, NULL, _IOLBF, 0);
  setvbuf(stderr, NULL, _IOLBF, 0);

  mg_mgr_init(&mgr, NULL);

  nc = mg_bind(&mgr, s_http_port, ev_handler);
  mg_set_protocol_http_websocket(nc);
  s_http_server_opts.document_root = "app/";  // Serve current directory
  s_http_server_opts.enable_directory_listing = "no";

  printf("Started on port %s\n", s_http_port);
  while (s_signal_received == 0) {
    mg_mgr_poll(&mgr, 200);
  }
  mg_mgr_free(&mgr);

  return 0;
}
