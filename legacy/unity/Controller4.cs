using UnityEngine;
using System.Collections;
using SharpNeat.Phenomes;
using System.Collections.Generic;

public class Controller4 : UnitController {


	public bool IsRunning;
	IBlackBox box;
	//	public double[] cellState;
	public Vector3 oldposition = new Vector2 (0,0);

	public float penalty;
	double memory;
	private Vector2 midPosition;
	private Vector2 lastPosition;
	private int numberOfCells;
	double cycle;
	float variation;

	// Use this for initialization
	void Start () {


		penalty = (float)10;
		oldposition = new Vector2(0,0);
		numberOfCells = 0;
		foreach (Transform child in transform) {
			oldposition.x = oldposition.x + child.transform.position.x;
			oldposition.y= oldposition.z + child.transform.position.z;
			numberOfCells++;
			SpringJoint[] childLinks = child.GetComponents<SpringJoint> ();
			foreach (SpringJoint childLink in childLinks)
			{   childLink.minDistance = 1;
				childLink.maxDistance = childLink.minDistance;
				childLink.enableCollision = false;
				childLink.spring = 10;
			}
		}

		oldposition = oldposition / numberOfCells;
		IsRunning = false;


	}






	// Update is called once per frame
	void FixedUpdate()
	{


		if (IsRunning) {


			GameObject evaluation = GameObject.Find("evaluator");
			Optimizer evalScript = evaluation.GetComponent<Optimizer>();
			//	if (evalScript.timeLeft>evalScript.TrialDuration/2)
			midPosition = new Vector2(0,0);
			numberOfCells = 0;

			foreach (Transform child in transform) {
				midPosition.x = midPosition.x + child.transform.position.x;
				midPosition.y = midPosition.y + child.transform.position.z;
				numberOfCells++;
			}
			midPosition = midPosition / numberOfCells;
			//if (evalScript.accum >evalScript.TrialDuration/2)
			//if ((Time.time) > 10)
			penalty = penalty + Vector2.Distance (midPosition, oldposition) / (evalScript.TrialDuration + 3);
			//else
			//	penalty = penalty - Vector2.Distance (midPosition, oldposition) / (evalScript.TrialDuration + 3);

			oldposition = midPosition;

			ISignalArray inputArr = box.InputSignalArray;


			//inputArr [0] = Mathf.Sin(Time.time/(float)cycle);
			//inputArr [2] = Mathf.Cos(Time.time);
			inputArr [0] = 1;

			box.Activate ();

			ISignalArray outputArr = box.OutputSignalArray;


			foreach (Transform child in transform) {
				int cellFrom = int.Parse(child.name);
				SpringJoint[] childLinks = child.GetComponents<SpringJoint> ();

				if (childLinks == null);
				//	Destroy (child);;
				else

					foreach (SpringJoint childLink in childLinks)
					{
						childLink.minDistance = 1;
						childLink.maxDistance = 1;
						int cellTo = int.Parse (childLink.connectedBody.name);

						if ((1 - outputArr [cellFrom * 3] * outputArr [cellTo * 3]) < 0.01) {	
							Destroy (childLink);
						}
						else if (1-(outputArr [cellFrom * 3] * outputArr [cellTo * 3]) < 0.5) {




							variation = ((float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom]+(float) 0.001)) + (float)outputArr [cellFrom * 2]) + Mathf.Sin ((2 * Time.time * Mathf.PI / ((float)outputArr [cellTo]+(float) 0.001)) + (float)outputArr [cellTo * 2]));
							childLink.minDistance = 1 + variation;
							childLink.maxDistance = childLink.minDistance;
						}
						else if (1- (outputArr [cellFrom * 3] * outputArr [cellTo * 3]) < 0.90) {

							GameObject theCellFrom = GameObject.Find (child.name);
							HingeJoint newJoint = theCellFrom.AddComponent<HingeJoint> ();
							newJoint.connectedBody = childLink.connectedBody;
							Destroy (childLink);
							penalty = penalty / 100;
						}
						else 
						{
							GameObject theCellFrom = GameObject.Find (child.name);
							FixedJoint newJoint = theCellFrom.AddComponent<FixedJoint> ();
							newJoint.connectedBody = childLink.connectedBody;
							Destroy (childLink);
							penalty = penalty / 100;
						}
					}
			}



		}
	}

	public override void Stop()
	{
		this.IsRunning = false;
	}

	public override void Activate(IBlackBox box)
	{
		this.box = box;
		this.IsRunning = true;
	}

	public override float GetFitness()
	{
		float fit = (float)0.000001;
		numberOfCells = 0;
		lastPosition = new Vector2 (0, 0);
		foreach (Transform child in this.transform) {
			lastPosition.x= lastPosition.x + child.transform.position.x;
			lastPosition.y= lastPosition.y + child.transform.position.z;
			numberOfCells++;
		}
		lastPosition = lastPosition / numberOfCells;
		midPosition = new Vector2 (0, 0);
		fit = Vector2.Distance (midPosition, lastPosition);
		if (fit > 100)
			fit = 0;
		return fit;


	}
}





//void OnGUI()
//{
//    GUI.Button(new Rect(10, 200, 100, 100), "Forward: " + MovingForward + "\nPiece: " + CurrentPiece + "\nLast: " + LastPiece + "\nLap: " + Lap);
//}

/*
			List<SpringJoint> joints = new List<SpringJoint>();

			foreach (Transform child in transform) {
				SpringJoint[] childLinks = child.GetComponents<SpringJoint> ();
				for (int count = 0; count < childLinks.Length; count++) {
					joints.Add(childLinks [count]);

				}

			}*/

//	for (int count = 0; count < childLinks.Length; count++) 

//		int from = int.Parse(childLinks [count].gameObject.name);
//		int to = int.Parse(childLinks [count].connectedBody.name);

//float m =(float)outputArr [0];
//float M =(float)outputArr [1 ];
//float p =(float)outputArr [2];
//float o = (float)outputArr [3];

/*
			for (int count = 0; count < joints.Count; count++) {


				GameObject jointFrom = joints[count].transform.parent.gameObject;
				GameObject jointTo = joints[count].connectedBody;


					
				joints[count].minDistance = joints[count].minDistance (1 + 0.15*(Mathf.Sin(2*Time.time*Mathf.PI/ 
				(float)outputArr [count + 1];

				//	if (outputArr [count + 2] < 0.4) {
				//		penalty = penalty + (float)0.005;
				//	}
				//(float)outputArr [count] * (1 + Mathf.Sin ((Time.time / 2) * Mathf.PI * 2));
				//	else {
				//joints [count].minDistance = 1+ (float)outputArr [count + 1];
				//	joints [count].maxDistance = joints [count].minDistance;
				//joints[count].spring = 300*(float)outputArr [count + 1];
				//	}

				/*else if (outputArr [count] > 0.9999999) {

					//					HingeJoint hingejoint = new HingeJoint (gameObject, joints [count].connectedBody);
					GameObject jointFrom = joints[count].transform.parent.gameObject;
					HingeJoint newhingejoint = jointFrom.AddComponent <HingeJoint>();
					newhingejoint.connectedBody = joints [count].connectedBody;
					Destroy (joints [count].gameObject);

				}
				//joints [count].minDistance = (float)outputArr[count+4]*(M - m) / 2 * (1 + Mathf.Sin((Time.time+o) * Mathf.PI * 2 / p)) + m;;
				//joints [count].maxDistance = (float)outputArr[count+4]*(M - m) / 2 * (1 + Mathf.Sin((Time.time+o) * Mathf.PI * 2 / p)) + m;;


			//cycle=outputArr[0];
		*/