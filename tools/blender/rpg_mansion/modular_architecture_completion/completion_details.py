"""Original stone and forged-metal architectural joinery."""
import math
from reference_walls_floors import ring

def profile(g,name,rows,mat='stone'):
 verts=[(x,y,z) for z,w,front,back in rows for x,y in [(-w/2,-front),(w/2,-front),(w/2,back),(-w/2,back)]]
 faces=[(3,2,1,0)]+[(k*4+i,k*4+(i+1)%4,(k+1)*4+(i+1)%4,(k+1)*4+i) for k in range(len(rows)-1) for i in range(4)]+[tuple(range((len(rows)-1)*4,len(rows)*4))]
 return g.mesh(name,verts,faces,mat)

def pilaster(g):
 profile(g,'Monolithic stone pilaster with weathered capital and level rear bearing tongue',[(0,.5,.18,0),(.15,.5,.18,0),(.22,.4,.13,0),(.28,.36,.10,0),(2.68,.34,.10,0),(2.75,.4,.14,0),(2.87,.5,.18,.12),(2.995,.5,.18,.12),(3,.5,0,.12)])
 ring(g,'Pilaster raised mitred border',[(-.14,.4),(.14,.4),(.14,2.5),(-.14,2.5)],[(-.115,.425),(.115,.425),(.115,2.475),(-.115,2.475)],'Y',-.118,-.10,'stone')
 g.box('Pilaster raised centre field',(-.10,-.11,.445),(.10,-.10,2.455),'stone')

def newel(g):
 profile(g,'Monolithic profiled stone railing newel',[(0,.30,.15,.15),(.10,.30,.15,.15),(.14,.24,.12,.12),(.18,.18,.09,.09),(.87,.18,.09,.09),(.90,.30,.15,.15),(1,.30,.15,.15),(1.045,.24,.12,.12),(1.10,.22,.11,.11)])

def balustrade(g):
 for z0,z1,name in [(0,.1,'plinth'),(.9,1.,'handrail')]:g.box('Continuous stone balustrade '+name,(-.45,-.12,z0),(.45,.12,z1),'stone')
 rows=[(.075,.10),(.075,.14),(.055,.17),(.044,.20),(.044,.25),(.068,.33),(.077,.38),(.070,.43),(.044,.48),(.032,.57),(.030,.76),(.055,.81),(.070,.86),(.070,.90)]
 n=20
 for x in [-.3,0,.3]:
  v=[(x+r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for r,z in rows for i in range(n)]
  f=[tuple(reversed(range(n)))]+[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(rows)-1) for i in range(n)]+[tuple(range((len(rows)-1)*n,len(rows)*n))]
  g.mesh('Turned stone baluster '+str(x),v,f,'stone',True)

def iron(g):
 g.box('Forged iron bottom crossrail',(-.45,-.025,.065),(.45,.025,.10),'iron')
 g.prism('Profiled forged iron handrail',[(-.025,.94),(.025,.94),(.033,.95),(.033,.982),(.021,1),(-.021,1),(-.033,.982),(-.033,.95)],'X',-.45,.45,'iron')
 for x in [-.375,-.225,-.075,.075,.225,.375]:g.box('Forged iron upright '+str(x),(x-.006,-.012,.10),(x+.006,.012,.94),'iron')
 n=24
 for x in [-.30,-.15,0,.15,.30]:
  for z in [.365,.685]:
   outer=[(x+.063*math.cos(i*math.tau/n),z+.13*math.sin(i*math.tau/n)) for i in range(n)];inner=[(x+.054*math.cos(i*math.tau/n),z+.12*math.sin(i*math.tau/n)) for i in range(n)]
   ring(g,'Forged oval ring %s %s'%(x,z),outer,inner,'Y',-.012,.012,'iron')
   for a,b in [(x-.075,x-.052),(x+.052,x+.075)]:g.box('Oval offset weld tab %s %s %s'%(x,z,a),(a,-.020,z-.012),(b,-.010,z+.012),'iron')
 for x in [-.375,.375]:g.box('Iron ground fixing shoe '+str(x),(x-.028,-.035,0),(x+.028,.035,.065),'iron')

def pediment(g):
 g.box('Continuous stone portico bearing beam',(-2.1,-.24,0),(2.1,.24,.24),'stone')
 outer=[(-2.1,.24),(2.1,.24),(0,1.44)];inner=[(-1.67,.38),(1.67,.38),(0,1.3342857142857143)]
 ring(g,'Triangular stone pediment raking moulding',outer,inner,'Y',-.24,.24,'stone')
 g.prism('Recessed plaster pediment tympanum',inner,'Y',-.075,.075,'plaster')
 poly=[]
 for i in range(40):
  a=math.tau*i/40;r=.14 if i%4 in [0,3] else .17;poly.append((r*math.cos(a),.78+r*math.sin(a)))
 g.prism('Original bronze sunburst pediment rosette',poly,'Y',-.092,-.075,'metal')
