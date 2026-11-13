#include <stdio.h>
#include <string.h>
#include "protocol.h"
static void show(char *name, anki_vehicle_msg_t *m, int n) { printf("%s:", name); for(int i=0;i<n;i++) printf(" %02x", ((unsigned char*)m)[i]); puts(""); }
#define CASE(label, call) do { memset(&m,0,sizeof(m)); int n=call; show(label,&m,n); } while(0)
int main(void) {
 anki_vehicle_msg_t m;
 CASE("sdk",anki_vehicle_msg_set_sdk_mode(&m,1,1));
 CASE("speed",anki_vehicle_msg_set_speed(&m,500,1000));
 CASE("stop",anki_vehicle_msg_set_speed(&m,0,2500));
 CASE("lane",anki_vehicle_msg_change_lane(&m,300,1000,-22.5f));
 CASE("offset",anki_vehicle_msg_set_offset_from_road_center(&m,-22.5f));
 CASE("turn",anki_vehicle_msg_turn_180(&m));
 CASE("lights",anki_vehicle_msg_set_lights(&m,0x11));
 CASE("ping",anki_vehicle_msg_ping(&m));
 CASE("version",anki_vehicle_msg_get_version(&m));
 CASE("battery",anki_vehicle_msg_get_battery_level(&m));
 CASE("cancel",anki_vehicle_msg_cancel_lane_change(&m));
 CASE("disconnect",anki_vehicle_msg_disconnect(&m));
 return 0;
}
